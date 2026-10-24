package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

// ExportBackup builds the full backup of an account: its library, its
// profile and every image they use, as a .zip, and when it was made. The
// same file whether it is downloaded or taken on a schedule, so that either
// restores the same way.
func ExportBackup(ctx context.Context, db *gorm.DB, user *models.User, imagesDir string) ([]byte, time.Time, error) {
	document, err := NewExporter(db, user.ID).Export(ctx)
	if err != nil {
		return nil, time.Time{}, err
	}
	archive, err := BuildBackupArchive(document, AccountEntryOf(user), imagesDir)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("building the backup: %w", err)
	}
	return archive, document.ExportedAt, nil
}

// BuildBackupArchive writes a Document and its account as gamelog.json, plus
// every cover and avatar either of them names, into a .zip.
//
// An image the database still names but whose file is gone from disk is left
// out rather than failing the whole export: a missing cover is something to
// notice in the application, not a reason a backup of everything else cannot
// be made.
func BuildBackupArchive(document *Document, account AccountEntry, imagesDir string) ([]byte, error) {
	body, err := json.Marshal(BackupDocument{Document: document, Account: account})
	if err != nil {
		return nil, fmt.Errorf("encoding the backup document: %w", err)
	}

	var buf bytes.Buffer
	archive := zip.NewWriter(&buf)

	entry, err := archive.Create(BackupDocumentName)
	if err != nil {
		return nil, err
	}
	if _, err := entry.Write(body); err != nil {
		return nil, err
	}

	for _, name := range referencedImages(document, account.AvatarURL) {
		if err := addImageToZip(archive, imagesDir, name); err != nil {
			return nil, err
		}
	}

	if err := archive.Close(); err != nil {
		return nil, fmt.Errorf("closing the backup archive: %w", err)
	}
	return buf.Bytes(), nil
}

func addImageToZip(archive *zip.Writer, imagesDir, name string) error {
	data, err := os.ReadFile(filepath.Join(imagesDir, name))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("reading %s: %w", name, err)
	}

	entry, err := archive.Create(path.Join("images", name))
	if err != nil {
		return err
	}
	_, err = entry.Write(data)
	return err
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
