// Package backups takes a full backup of every account on a schedule, and
// keeps a daily, weekly and monthly history of them without filling the
// disk.
package backups

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/service"
	"github.com/mperezfo/gamelog/internal/slug"
)

// Retention is how many backups to keep of each kind: the newest of each of
// the last that many days, ISO weeks and months that have one.
type Retention struct {
	Daily, Weekly, Monthly int
}

// Every is how often the scheduler looks for a backup to take: often enough
// that a day is never missed, and a failed one is tried again soon.
const Every = time.Hour

// Scheduler takes the backups. It keeps no state of its own: what is due and
// what to prune both follow from the files already there.
type Scheduler struct {
	db        *gorm.DB
	imagesDir string
	dir       string
	retention Retention
	now       func() time.Time
}

// New builds a scheduler storing backups under dir, a directory per account.
// now is the clock, which a test can turn forward.
func New(db *gorm.DB, imagesDir, dir string, retention Retention, now func() time.Time) *Scheduler {
	return &Scheduler{db: db, imagesDir: imagesDir, dir: dir, retention: retention, now: now}
}

// Run takes the backups due now, then looks again every hour, until ctx is
// done. A failure is logged and tried again on the next run: it never stops
// the server.
func (s *Scheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(Every)
	defer ticker.Stop()
	for {
		if err := s.RunOnce(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("scheduled backups failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// RunOnce takes today's backup of every account that has none yet, and
// prunes the ones no longer kept. One account failing does not stop the
// others: their errors are returned together.
func (s *Scheduler) RunOnce(ctx context.Context) error {
	users, err := repository.NewUserRepository(s.db).List(ctx)
	if err != nil {
		return fmt.Errorf("listing the accounts: %w", err)
	}

	var errs []error
	for _, user := range users {
		// The admin owns no library: there is nothing to back up.
		if user.IsAdmin {
			continue
		}
		if err := s.backUp(ctx, &user); err != nil {
			errs = append(errs, fmt.Errorf("account %q: %w", user.Username, err))
		}
	}
	return errors.Join(errs...)
}

// backUp takes one account's backup for today, unless it is there already,
// then prunes its history.
func (s *Scheduler) backUp(ctx context.Context, user *models.User) error {
	dir := filepath.Join(s.dir, accountDir(user))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	name := service.BackupFilename(s.now())
	target := filepath.Join(dir, name)
	if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
		if err := s.write(ctx, user, dir, target); err != nil {
			return err
		}
		slog.Info("backup taken", "account", user.Username, "file", target)
	} else if err != nil {
		return err
	}

	return s.prune(dir)
}

// write stores the backup under a temporary name first, so that a backup
// cut short is never mistaken for a whole one.
func (s *Scheduler) write(ctx context.Context, user *models.User, dir, target string) error {
	archive, _, err := service.ExportBackup(ctx, s.db, user, s.imagesDir)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, tempPattern)
	if err != nil {
		return err
	}
	if _, err := file.Write(archive); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(file.Name())
		return err
	}
	if err := os.Rename(file.Name(), target); err != nil {
		_ = os.Remove(file.Name())
		return err
	}
	return nil
}

// tempPattern names a backup being written; one left behind by a crash is
// cleared on the next prune.
const tempPattern = ".gamelog-backup-*.tmp"

// prune deletes the backups of an account that Keep does not keep. Only
// files named like a backup are ever touched.
func (s *Scheduler) prune(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var backups []Backup
	for _, entry := range entries {
		if matched, _ := filepath.Match(tempPattern, entry.Name()); matched {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
			continue
		}
		if backup, ok := parseName(entry.Name()); ok && entry.Type().IsRegular() {
			backups = append(backups, backup)
		}
	}

	kept := Keep(backups, s.retention)
	var errs []error
	for _, backup := range backups {
		if kept[backup.Name] {
			continue
		}
		if err := os.Remove(filepath.Join(dir, backup.Name)); err != nil {
			errs = append(errs, err)
			continue
		}
		slog.Info("backup pruned", "file", filepath.Join(dir, backup.Name))
	}
	return errors.Join(errs...)
}

// Backup is one backup file, and the day it was taken on.
type Backup struct {
	Name string
	Day  time.Time
}

var namePattern = regexp.MustCompile(`^gamelog-backup-(\d{4}-\d{2}-\d{2})\.zip$`)

// parseName reads the day out of a backup's name (see
// service.BackupFilename).
func parseName(name string) (Backup, bool) {
	match := namePattern.FindStringSubmatch(name)
	if match == nil {
		return Backup{}, false
	}
	day, err := time.Parse(time.DateOnly, match[1])
	if err != nil {
		return Backup{}, false
	}
	return Backup{Name: name, Day: day}, true
}

// Keep says which backups to keep, by name: the newest of each of the last
// Daily days, Weekly ISO weeks and Monthly months that have a backup. A
// backup kept for any reason is kept.
func Keep(backups []Backup, retention Retention) map[string]bool {
	newestFirst := slices.Clone(backups)
	slices.SortFunc(newestFirst, func(a, b Backup) int { return b.Day.Compare(a.Day) })

	kept := map[string]bool{}
	keepNewestOf := func(count int, period func(time.Time) string) {
		seen := map[string]bool{}
		for _, backup := range newestFirst {
			if len(seen) == count {
				return
			}
			key := period(backup.Day)
			if seen[key] {
				continue
			}
			seen[key] = true
			kept[backup.Name] = true
		}
	}
	keepNewestOf(retention.Daily, func(day time.Time) string { return day.Format(time.DateOnly) })
	keepNewestOf(retention.Weekly, func(day time.Time) string {
		year, week := day.ISOWeek()
		return strconv.Itoa(year) + "-W" + strconv.Itoa(week)
	})
	keepNewestOf(retention.Monthly, func(day time.Time) string { return day.Format("2006-01") })
	return kept
}

// accountDir is the directory an account's backups go in: its id, which
// keeps two accounts apart whatever their names, then its username folded
// into a safe file name so the directory is easy to tell ("7-martin" for
// "Martín"), or the id alone when nothing of the username survives.
func accountDir(user *models.User) string {
	id := strconv.FormatUint(user.ID, 10)
	if name := slug.Fold(user.Username); name != "" {
		return id + "-" + name
	}
	return id
}
