package backups

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/service"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// daily is one backup a day from first to last, both included.
func daily(first, last string) []Backup {
	from, _ := time.Parse(time.DateOnly, first)
	to, _ := time.Parse(time.DateOnly, last)
	var backups []Backup
	for day := from; !day.After(to); day = day.AddDate(0, 0, 1) {
		backups = append(backups, Backup{Name: service.BackupFilename(day), Day: day})
	}
	return backups
}

// keptDays lists the days Keep keeps, oldest first.
func keptDays(backups []Backup, retention Retention) []string {
	kept := Keep(backups, retention)
	var days []string
	for _, backup := range backups {
		if kept[backup.Name] {
			days = append(days, backup.Day.Format(time.DateOnly))
		}
	}
	slices.Sort(days)
	return days
}

func TestKeepFollowsEachTier(t *testing.T) {
	// A backup every day from 1 August to Saturday 24 October 2026.
	backups := daily("2026-08-01", "2026-10-24")

	for _, tc := range []struct {
		name      string
		retention Retention
		want      []string
	}{
		{"nothing", Retention{}, nil},
		{"the last three days", Retention{Daily: 3}, []string{"2026-10-22", "2026-10-23", "2026-10-24"}},
		// The newest of each ISO week: Sundays, and this week's Saturday.
		{"the last three weeks", Retention{Weekly: 3}, []string{"2026-10-11", "2026-10-18", "2026-10-24"}},
		{"the last three months", Retention{Monthly: 3}, []string{"2026-08-31", "2026-09-30", "2026-10-24"}},
		{
			"all three, overlapping",
			Retention{Daily: 2, Weekly: 2, Monthly: 2},
			[]string{"2026-09-30", "2026-10-18", "2026-10-23", "2026-10-24"},
		},
	} {
		if got := keptDays(backups, tc.retention); !slices.Equal(got, tc.want) {
			t.Errorf("%s: kept %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestKeepCountsDaysThatHaveABackup(t *testing.T) {
	// A server that was down for most of October still keeps three dailies:
	// the last three days that have one, not the last three on the calendar.
	backups := append(daily("2026-09-28", "2026-09-30"), daily("2026-10-24", "2026-10-24")...)
	want := []string{"2026-09-29", "2026-09-30", "2026-10-24"}
	if got := keptDays(backups, Retention{Daily: 3}); !slices.Equal(got, want) {
		t.Errorf("kept %v, want %v", got, want)
	}
}

func TestRunOnceTakesOneBackupADayAndPrunes(t *testing.T) {
	db := testsupport.NewDatabase(t)
	ctx := context.Background()
	users := repository.NewUserRepository(db)
	player := &models.User{Username: "player", PasswordHash: "hash"}
	odd := &models.User{Username: "../odd name", PasswordHash: "hash"}
	admin := &models.User{Username: "admin", PasswordHash: "hash", IsAdmin: true}
	for _, user := range []*models.User{player, odd, admin} {
		if err := users.Create(ctx, user); err != nil {
			t.Fatalf("creating %q: %v", user.Username, err)
		}
	}

	dir := t.TempDir()
	now := time.Date(2026, 10, 20, 3, 0, 0, 0, time.UTC)
	scheduler := New(db, t.TempDir(), dir, Retention{Daily: 2}, func() time.Time { return now })

	playerDir := filepath.Join(dir, "player")
	// Not a backup's name: never touched.
	if err := os.MkdirAll(playerDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(playerDir, "notes.txt"), []byte("mine"), 0o644); err != nil {
		t.Fatal(err)
	}

	for range 4 {
		// Twice a day: the second run finds today's backup already there.
		for range 2 {
			if err := scheduler.RunOnce(ctx); err != nil {
				t.Fatalf("RunOnce on %s: %v", now.Format(time.DateOnly), err)
			}
			now = now.Add(Every)
		}
		now = now.Add(24*time.Hour - 2*Every)
	}

	names := func(dir string) []string {
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatalf("reading %s: %v", dir, err)
		}
		var names []string
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		return names
	}
	want := []string{"gamelog-backup-2026-10-22.zip", "gamelog-backup-2026-10-23.zip", "notes.txt"}
	if got := names(playerDir); !slices.Equal(got, want) {
		t.Errorf("player's backups = %v, want %v", got, want)
	}
	// An account whose name is no safe file name goes under its id; the
	// admin, who owns no library, has none.
	if got := names(dir); !slices.Equal(got, []string{"player", "user-" + itoa(odd.ID)}) {
		t.Errorf("accounts with backups = %v", got)
	}

	// What is stored is the same backup an export downloads, which restores
	// through the usual restore.
	archive, err := zip.OpenReader(filepath.Join(playerDir, "gamelog-backup-2026-10-23.zip"))
	if err != nil {
		t.Fatalf("opening a backup: %v", err)
	}
	defer archive.Close()
	if len(archive.File) == 0 || archive.File[0].Name != service.BackupDocumentName {
		t.Errorf("the backup holds %v, want %s first", archive.File, service.BackupDocumentName)
	}
}

func itoa(id uint64) string { return strconv.FormatUint(id, 10) }
