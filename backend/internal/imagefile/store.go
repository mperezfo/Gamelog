package imagefile

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
)

// URLPrefix is what a stored image's name is prefixed with to make the URL a
// game's cover or an account's picture points at.
const URLPrefix = "/api/images/"

// WriteFile writes to a temporary name in the same directory and renames it
// into place, so a request that fails partway through never leaves a
// truncated file at the URL another request just handed out.
func WriteFile(path string, src io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating the images directory: %w", err)
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return fmt.Errorf("creating a temporary file: %w", err)
	}
	defer os.Remove(tmp.Name())

	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return fmt.Errorf("writing the image: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("closing the image: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("finalising the image: %w", err)
	}
	return nil
}

// Store keeps data at path, written as WriteFile does unless a file is
// already there, which, names being content-addressed, holds these very
// bytes. Either way the file is left marked as modified now: -prune-images
// spares an unused image by how recent it is (see PruneGrace), and one just
// uploaded, picked or restored is about to be used, even when the same bytes
// were stored, and left unused, long before.
func Store(path string, data []byte) error {
	now := time.Now()
	err := os.Chtimes(path, now, now)
	if err == nil {
		return nil
	}
	if !os.IsNotExist(err) {
		return fmt.Errorf("marking %s as just stored: %w", filepath.Base(path), err)
	}
	return WriteFile(path, bytes.NewReader(data))
}

// Conversion is one stored image NormalizeStored replaced, or would replace.
type Conversion struct {
	From  string
	To    string
	Found Format
	// How many games and accounts pointed at From, and now point at To.
	Games int64
	Users int64
}

// Failure is a stored image NormalizeStored could not read.
type Failure struct {
	Name string
	Err  error
}

// Report is what NormalizeStored did, or would do in a dry run.
type Report struct {
	Checked   int
	Converted []Conversion
	Failed    []Failure
}

// StoredNames lists every stored image in dir: the originals, not the
// thumbnails made from them, which live in a subdirectory.
func StoredNames(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("listing %s: %w", dir, err)
	}
	var names []string
	for _, entry := range entries {
		if entry.Type().IsRegular() && ValidName(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// NormalizeStored makes sure each of these stored images really is what its
// name says, and of a type the backend can read (see Normalize).
//
// An image that is not is converted (or, for a readable type stored under
// the wrong extension, renamed) and stored under its new name. Every game
// cover and account picture that pointed at the old name is moved to the new
// one, across all accounts, since the same bytes are one file whoever
// uploaded them. The old file and its thumbnails are deleted after that.
//
// It is safe to run again, and to interrupt: an image already right is left
// alone, and one whose references were never moved is found again next time.
// A dry run reports what would change and changes nothing.
func NormalizeStored(ctx context.Context, db *gorm.DB, dir string, names []string, dryRun bool) (Report, error) {
	var report Report
	for _, name := range names {
		if !ValidName(name) {
			continue
		}
		report.Checked++

		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			report.Failed = append(report.Failed, Failure{Name: name, Err: err})
			continue
		}

		ext := filepath.Ext(name)
		found := Sniff(data)
		if found == formatOf(ext) {
			continue
		}

		normalized, newExt, err := Normalize(data)
		if err != nil {
			report.Failed = append(report.Failed, Failure{Name: name, Err: err})
			continue
		}
		conversion := Conversion{From: name, To: Name(normalized, newExt), Found: found}

		if dryRun {
			conversion.Games, conversion.Users, err = countReferences(ctx, db, name)
		} else {
			err = replace(ctx, db, dir, data, normalized, &conversion)
		}
		if err != nil {
			return report, fmt.Errorf("converting %s: %w", name, err)
		}
		report.Converted = append(report.Converted, conversion)
	}
	return report, nil
}

// replace stores the normalised image, moves every reference to it, and
// deletes the old file and its thumbnails, in that order: whatever point it
// stops at, nothing is left pointing at a file that is gone.
func replace(ctx context.Context, db *gorm.DB, dir string, original, normalized []byte, conversion *Conversion) error {
	newPath := filepath.Join(dir, conversion.To)
	if _, err := os.Stat(newPath); os.IsNotExist(err) {
		if err := WriteFile(newPath, bytes.NewReader(normalized)); err != nil {
			return err
		}
	}

	// UpdateColumn: it is the same picture, so neither a game's updated_at
	// nor any update hook should notice.
	from, to := URLPrefix+conversion.From, URLPrefix+conversion.To
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		games := tx.Model(&models.Game{}).Where("cover_image_url = ?", from).UpdateColumn("cover_image_url", to)
		if games.Error != nil {
			return fmt.Errorf("moving game covers: %w", games.Error)
		}
		users := tx.Model(&models.User{}).Where("avatar_url = ?", from).UpdateColumn("avatar_url", to)
		if users.Error != nil {
			return fmt.Errorf("moving account pictures: %w", users.Error)
		}
		conversion.Games, conversion.Users = games.RowsAffected, users.RowsAffected
		return nil
	})
	if err != nil {
		return err
	}

	if err := os.Remove(filepath.Join(dir, conversion.From)); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("deleting the old file: %w", err)
	}
	// A renamed file keeps its bytes, and so the stem its thumbnails are
	// found by. Only a converted one leaves thumbnails of the old bytes.
	oldStem := strings.TrimSuffix(conversion.From, filepath.Ext(conversion.From))
	newStem := strings.TrimSuffix(conversion.To, filepath.Ext(conversion.To))
	if oldStem != newStem {
		thumbnails, _ := filepath.Glob(filepath.Join(dir, "thumbs", "*", oldStem+".*"))
		for _, thumbnail := range thumbnails {
			if err := os.Remove(thumbnail); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("deleting an old thumbnail: %w", err)
			}
		}
	}
	return nil
}

func countReferences(ctx context.Context, db *gorm.DB, name string) (games, users int64, err error) {
	url := URLPrefix + name
	if err := db.WithContext(ctx).Model(&models.Game{}).Where("cover_image_url = ?", url).Count(&games).Error; err != nil {
		return 0, 0, fmt.Errorf("counting game covers: %w", err)
	}
	if err := db.WithContext(ctx).Model(&models.User{}).Where("avatar_url = ?", url).Count(&users).Error; err != nil {
		return 0, 0, fmt.Errorf("counting account pictures: %w", err)
	}
	return games, users, nil
}
