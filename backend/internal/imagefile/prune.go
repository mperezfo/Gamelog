package imagefile

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
)

// PruneGrace is how old an image no game or account uses has to be before
// PruneStored deletes it. An image is stored the moment it is uploaded or
// picked, before the form it is for is saved, and a backup being restored
// writes its images before the rows that use them: anything this recent may
// be about to be used.
const PruneGrace = time.Hour

// PrunedImage is one stored image PruneStored deleted, or would delete.
type PrunedImage struct {
	Name string
	// Size is the bytes it frees: the original and its thumbnails.
	Size int64
	// Thumbnails is how many thumbnails went with it.
	Thumbnails int
}

// PruneReport is what PruneStored did, or would do in a dry run.
type PruneReport struct {
	Checked int
	Pruned  []PrunedImage
	// Recent is how many unused images were kept for being newer than
	// PruneGrace.
	Recent int
	// StrayThumbnails is how many thumbnails were left of originals that are
	// gone, deleted too, and StraySize the bytes they took.
	StrayThumbnails int
	StraySize       int64
}

// Freed is how many bytes the prune freed, or would free.
func (r PruneReport) Freed() int64 {
	freed := r.StraySize
	for _, image := range r.Pruned {
		freed += image.Size
	}
	return freed
}

// PruneStored deletes the stored images no game cover and no account
// picture points at, across all accounts, along with their thumbnails, and
// any thumbnail whose original is already gone. Images are never deleted
// otherwise: replacing or removing a cover, or abandoning a form after
// picking one, leaves the file behind.
//
// An unused image newer than PruneGrace is kept (see there). The references
// are read before the files are listed, so an image stored in between is
// one of those.
//
// It is safe to run again, and to interrupt: what one run leaves, the next
// finds. A dry run reports what would be deleted and deletes nothing.
func PruneStored(ctx context.Context, db *gorm.DB, dir string, now time.Time, dryRun bool) (PruneReport, error) {
	var report PruneReport

	used, err := usedNames(ctx, db)
	if err != nil {
		return report, err
	}
	names, err := StoredNames(dir)
	if err != nil {
		return report, err
	}

	// The stems of the originals that stay and of those pruned, which their
	// thumbnails are named by.
	kept, pruned := map[string]bool{}, map[string]bool{}
	for _, name := range names {
		report.Checked++
		stem := strings.TrimSuffix(name, filepath.Ext(name))
		if used[name] {
			kept[stem] = true
			continue
		}

		info, err := os.Stat(filepath.Join(dir, name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return report, fmt.Errorf("reading %s: %w", name, err)
		}
		if now.Sub(info.ModTime()) < PruneGrace {
			report.Recent++
			kept[stem] = true
			continue
		}

		image := PrunedImage{Name: name, Size: info.Size()}
		thumbnails, _ := filepath.Glob(filepath.Join(dir, "thumbs", "*", stem+".*"))
		// The thumbnails before the original: stopped in between, the
		// original is still there for the next run to find.
		for _, thumbnail := range thumbnails {
			size, err := remove(thumbnail, dryRun)
			if err != nil {
				return report, err
			}
			image.Size += size
			image.Thumbnails++
		}
		if _, err := remove(filepath.Join(dir, name), dryRun); err != nil {
			return report, err
		}
		report.Pruned = append(report.Pruned, image)
		pruned[stem] = true
	}

	thumbnails, _ := filepath.Glob(filepath.Join(dir, "thumbs", "*", "*"))
	for _, thumbnail := range thumbnails {
		base := filepath.Base(thumbnail)
		stem := strings.TrimSuffix(base, filepath.Ext(base))
		// Anything that is not named like a thumbnail is not one this
		// package made, and is left alone.
		// One whose original was pruned above is gone already, or, in a dry
		// run, counted with it.
		if kept[stem] || pruned[stem] || !ValidName(stem+".jpg") {
			continue
		}
		size, err := remove(thumbnail, dryRun)
		if err != nil {
			return report, err
		}
		report.StrayThumbnails++
		report.StraySize += size
	}
	return report, nil
}

// usedNames is the name of every stored image a game cover or an account
// picture points at.
func usedNames(ctx context.Context, db *gorm.DB) (map[string]bool, error) {
	var urls []string
	if err := db.WithContext(ctx).Model(&models.Game{}).
		Where("cover_image_url IS NOT NULL").Pluck("cover_image_url", &urls).Error; err != nil {
		return nil, fmt.Errorf("reading game covers: %w", err)
	}
	var avatars []string
	if err := db.WithContext(ctx).Model(&models.User{}).
		Where("avatar_url IS NOT NULL").Pluck("avatar_url", &avatars).Error; err != nil {
		return nil, fmt.Errorf("reading account pictures: %w", err)
	}

	used := make(map[string]bool, len(urls)+len(avatars))
	for _, url := range append(urls, avatars...) {
		if name, ok := strings.CutPrefix(url, URLPrefix); ok {
			used[name] = true
		}
	}
	return used, nil
}

// remove deletes a file, unless this is a dry run, and returns its size.
func remove(path string, dryRun bool) (int64, error) {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("reading %s: %w", path, err)
	}
	if dryRun {
		return info.Size(), nil
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return 0, fmt.Errorf("deleting %s: %w", path, err)
	}
	return info.Size(), nil
}
