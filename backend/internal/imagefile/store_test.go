package imagefile

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// store writes data into dir under name, as an upload once would have.
func store(t *testing.T, dir, name string, data []byte) {
	t.Helper()
	if err := WriteFile(filepath.Join(dir, name), bytes.NewReader(data)); err != nil {
		t.Fatalf("storing %s: %v", name, err)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestNormalizeStoredConvertsAndMovesEveryReference(t *testing.T) {
	ctx := context.Background()
	db := testsupport.NewDatabase(t)
	dir := t.TempDir()

	users := repository.NewUserRepository(db)
	user := &models.User{Username: "ana", PasswordHash: "not a real hash"}
	if err := users.Create(ctx, user); err != nil {
		t.Fatalf("creating the account: %v", err)
	}

	// An AVIF stored as a PNG, the way a browser's upload let it in, with a
	// thumbnail of it already made.
	avifData := encodeAVIF(t, square(16, red))
	avifName := Name(avifData, ".png")
	store(t, dir, avifName, avifData)
	avifStem := avifName[:64]
	store(t, dir, filepath.Join("thumbs", "sm", avifStem+".jpg"), encodeJPEG(t, square(4, red)))

	// A JPEG stored as a PNG: readable, only misnamed.
	jpegData := encodeJPEG(t, square(8, red))
	jpegName := Name(jpegData, ".png")
	store(t, dir, jpegName, jpegData)

	// And one that is already right.
	goodData := encodeJPEG(t, square(12, red))
	goodName := Name(goodData, ".jpg")
	store(t, dir, goodName, goodData)

	games := repository.NewGameRepository(db, user.ID)
	cover := URLPrefix + avifName
	game := &models.Game{Title: "Rayman Legends Retold", Status: models.StatusWishlist, CoverImageURL: &cover}
	if err := games.Create(ctx, game, repository.GameRelations{}); err != nil {
		t.Fatalf("creating the game: %v", err)
	}
	avatar := URLPrefix + jpegName
	if err := db.Model(user).UpdateColumn("avatar_url", avatar).Error; err != nil {
		t.Fatalf("setting the avatar: %v", err)
	}
	// As the database keeps it, at its own precision.
	var before models.Game
	if err := db.First(&before, game.ID).Error; err != nil {
		t.Fatalf("reading the game: %v", err)
	}

	names, err := StoredNames(dir)
	if err != nil {
		t.Fatalf("StoredNames: %v", err)
	}
	if len(names) != 3 {
		t.Fatalf("StoredNames = %v, want the three originals and no thumbnail", names)
	}

	dry, err := NormalizeStored(ctx, db, dir, names, true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}
	if len(dry.Converted) != 2 || !exists(filepath.Join(dir, avifName)) {
		t.Fatalf("dry run converted %d and left the AVIF? %v; want 2 reported and nothing touched",
			len(dry.Converted), exists(filepath.Join(dir, avifName)))
	}

	report, err := NormalizeStored(ctx, db, dir, names, false)
	if err != nil {
		t.Fatalf("NormalizeStored: %v", err)
	}
	if report.Checked != 3 || len(report.Converted) != 2 || len(report.Failed) != 0 {
		t.Fatalf("report = %+v, want 3 checked and 2 converted", report)
	}

	var stored models.Game
	if err := db.First(&stored, game.ID).Error; err != nil {
		t.Fatalf("reading the game back: %v", err)
	}
	newCover := filepath.Base(*stored.CoverImageURL)
	if filepath.Ext(newCover) != ".jpg" || newCover == avifName {
		t.Errorf("cover = %s, want a new .jpg", *stored.CoverImageURL)
	}
	if data, err := os.ReadFile(filepath.Join(dir, newCover)); err != nil || Sniff(data) != JPEG {
		t.Errorf("the new cover is not a JPEG on disk (err %v)", err)
	}
	if !stored.UpdatedAt.Equal(before.UpdatedAt) {
		t.Error("moving the cover changed the game's updated_at")
	}

	var reloaded models.User
	if err := db.First(&reloaded, user.ID).Error; err != nil {
		t.Fatalf("reading the account back: %v", err)
	}
	if want := URLPrefix + jpegName[:64] + ".jpg"; reloaded.AvatarURL == nil || *reloaded.AvatarURL != want {
		t.Errorf("avatar = %v, want the same bytes renamed to %s", reloaded.AvatarURL, want)
	}

	if exists(filepath.Join(dir, avifName)) || exists(filepath.Join(dir, jpegName)) {
		t.Error("an old file was left behind")
	}
	if exists(filepath.Join(dir, "thumbs", "sm", avifStem+".jpg")) {
		t.Error("the thumbnail of the old AVIF was left behind")
	}
	if !exists(filepath.Join(dir, goodName)) {
		t.Error("an image that was already right was touched")
	}

	names, _ = StoredNames(dir)
	again, err := NormalizeStored(ctx, db, dir, names, false)
	if err != nil || len(again.Converted) != 0 {
		t.Errorf("a second run converted %d (err %v), want nothing", len(again.Converted), err)
	}
}
