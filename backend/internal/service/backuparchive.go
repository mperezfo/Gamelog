package service

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/imagefile"
	"github.com/mperezfo/gamelog/internal/models"
)

// BackupDocumentName is the library and account document inside a backup
// .zip. Everything else in the archive is an image, under images/.
const BackupDocumentName = "gamelog.json"

// BackupFilename is what a full backup made at a moment is called: what a
// browser saves one as, and what a scheduled one is stored as.
func BackupFilename(at time.Time) string {
	return "gamelog-backup-" + at.Format(time.DateOnly) + ".zip"
}

// AccountEntryOf is the account section of a backup of user.
func AccountEntryOf(user *models.User) AccountEntry {
	return AccountEntry{
		Name:         user.Name,
		AvatarURL:    user.AvatarURL,
		PasswordHash: user.PasswordHash,
		Preferences:  user.Preferences,
	}
}

// ExportBackup writes the full backup of an account to w: its library, its
// profile and every image they use, as a .zip. It returns when the backup
// was made. The same file whether it is downloaded or taken on a schedule,
// so that either restores the same way.
//
// The archive is streamed, so a scheduled backup goes straight to its file
// and only one image at a time is held in memory.
func ExportBackup(ctx context.Context, db *gorm.DB, user *models.User, imagesDir string, w io.Writer) (time.Time, error) {
	document, err := NewExporter(db, user.ID).Export(ctx)
	if err != nil {
		return time.Time{}, err
	}
	if err := writeBackupArchive(w, document, AccountEntryOf(user), imagesDir); err != nil {
		return time.Time{}, fmt.Errorf("building the backup: %w", err)
	}
	return document.ExportedAt, nil
}

// writeBackupArchive writes a Document and its account as gamelog.json, plus
// every cover and avatar either of them names, into a .zip.
//
// An image the database still names but whose file is gone from disk is left
// out rather than failing the whole export: a missing cover is something to
// notice in the application, not a reason a backup of everything else cannot
// be made.
func writeBackupArchive(w io.Writer, document *Document, account AccountEntry, imagesDir string) error {
	body, err := json.Marshal(BackupDocument{Document: document, Account: account})
	if err != nil {
		return fmt.Errorf("encoding the backup document: %w", err)
	}

	archive := zip.NewWriter(w)

	entry, err := archive.Create(BackupDocumentName)
	if err != nil {
		return err
	}
	if _, err := entry.Write(body); err != nil {
		return err
	}

	for _, name := range referencedImages(document, account.AvatarURL) {
		if err := addImageToZip(archive, imagesDir, name); err != nil {
			return err
		}
	}

	if err := archive.Close(); err != nil {
		return fmt.Errorf("closing the backup archive: %w", err)
	}
	return nil
}

func addImageToZip(archive *zip.Writer, imagesDir, name string) error {
	file, err := os.Open(filepath.Join(imagesDir, name))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("reading %s: %w", name, err)
	}
	defer file.Close()

	entry, err := archive.Create(path.Join("images", name))
	if err != nil {
		return err
	}
	if _, err := io.Copy(entry, file); err != nil {
		return fmt.Errorf("reading %s: %w", name, err)
	}
	return nil
}

// referencedImages is the de-duplicated, content-addressed filenames a
// document's covers and an account's avatar point at.
func referencedImages(document *Document, avatarURL *string) []string {
	seen := map[string]struct{}{}
	var names []string

	add := func(url *string) {
		if url == nil {
			return
		}
		name, ok := strings.CutPrefix(*url, "/api/images/")
		if !ok || !imagefile.ValidName(name) {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}

	add(avatarURL)
	for _, game := range document.Games {
		add(game.CoverImageURL)
	}
	return names
}
