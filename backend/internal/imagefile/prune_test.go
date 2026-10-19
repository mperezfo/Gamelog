package imagefile

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

func TestPruneStoredDeletesWhatNothingUses(t *testing.T) {
	ctx := context.Background()
	db := testsupport.NewDatabase(t)
	dir := t.TempDir()
	now := time.Now()
	old := now.Add(-2 * PruneGrace)

	// storeAged stores an image of the given size, last written at when, and
	// returns its name.
	storeAged := func(side int, when time.Time) string {
		t.Helper()
		data := encodeJPEG(t, square(side, red))
		name := Name(data, ".jpg")
		store(t, dir, name, data)
		if err := os.Chtimes(filepath.Join(dir, name), when, when); err != nil {
			t.Fatalf("aging %s: %v", name, err)
		}
		return name
	}
	thumbnail := func(size, name string) string {
		t.Helper()
		path := filepath.Join("thumbs", size, name[:64]+".jpg")
		store(t, dir, path, encodeJPEG(t, square(2, red)))
		return path
	}

	cover := storeAged(8, old)
	avatar := storeAged(10, old)
	unused := storeAged(12, old)
	recent := storeAged(14, now.Add(-time.Minute))
	coverThumbnail := thumbnail("sm", cover)
	unusedThumbnails := []string{thumbnail("sm", unused), thumbnail("md", unused)}
	// A thumbnail of an original deleted by hand, and a file that is no
	// thumbnail at all.
	stray := thumbnail("md", Name([]byte("gone"), ".png"))
	store(t, dir, filepath.Join("thumbs", "sm", "notes.txt"), []byte("not a thumbnail"))

	users := repository.NewUserRepository(db)
	user := &models.User{Username: "ana", PasswordHash: "not a real hash"}
	if err := users.Create(ctx, user); err != nil {
		t.Fatalf("creating the account: %v", err)
	}
	if err := db.Model(user).UpdateColumn("avatar_url", URLPrefix+avatar).Error; err != nil {
		t.Fatalf("setting the avatar: %v", err)
	}
	coverURL := URLPrefix + cover
	game := &models.Game{Title: "Celeste", Status: models.StatusPlayed, CoverImageURL: &coverURL}
	if err := repository.NewGameRepository(db, user.ID).Create(ctx, game, repository.GameRelations{}); err != nil {
		t.Fatalf("creating the game: %v", err)
	}
	// A game without a cover is no reference to anything.
	bare := &models.Game{Title: "Deponia", Status: models.StatusWishlist}
	if err := repository.NewGameRepository(db, user.ID).Create(ctx, bare, repository.GameRelations{}); err != nil {
		t.Fatalf("creating the bare game: %v", err)
	}

	everything := []string{cover, avatar, unused, recent, coverThumbnail, stray, filepath.Join("thumbs", "sm", "notes.txt")}
	everything = append(everything, unusedThumbnails...)

	dry, err := PruneStored(ctx, db, dir, now, true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if len(dry.Pruned) != 1 || dry.Pruned[0].Name != unused || dry.Pruned[0].Thumbnails != 2 {
		t.Errorf("dry run would prune %+v, want %s and its two thumbnails", dry.Pruned, unused)
	}
	if dry.Checked != 4 || dry.Recent != 1 || dry.StrayThumbnails != 1 || dry.Freed() == 0 {
		t.Errorf("dry run report = %+v, want 4 checked, 1 recent, 1 stray thumbnail and bytes to free", dry)
	}
	for _, path := range everything {
		if !exists(filepath.Join(dir, path)) {
			t.Errorf("the dry run deleted %s", path)
		}
	}

	report, err := PruneStored(ctx, db, dir, now, false)
	if err != nil {
		t.Fatalf("PruneStored: %v", err)
	}
	if len(report.Pruned) != 1 || report.StrayThumbnails != 1 || report.Freed() != dry.Freed() {
		t.Errorf("report = %+v, want what the dry run said", report)
	}
	gone := append([]string{unused, stray}, unusedThumbnails...)
	for _, path := range gone {
		if exists(filepath.Join(dir, path)) {
			t.Errorf("%s is still there", path)
		}
	}
	for _, path := range []string{cover, avatar, recent, coverThumbnail, filepath.Join("thumbs", "sm", "notes.txt")} {
		if !exists(filepath.Join(dir, path)) {
			t.Errorf("%s was deleted, want it kept", path)
		}
	}

	again, err := PruneStored(ctx, db, dir, now, false)
	if err != nil {
		t.Fatalf("running again: %v", err)
	}
	if len(again.Pruned) != 0 || again.StrayThumbnails != 0 {
		t.Errorf("running again pruned %+v, want nothing left to do", again)
	}
}
