package repository_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// fixture is a database plus the repositories under test, all scoped to the
// same account: like a game repository, a lookup repository now belongs to
// one owner (see migration 00013).
type fixture struct {
	db         *gorm.DB
	users      *repository.UserRepository
	owner      *models.User
	games      *repository.GameRepository
	genres     *repository.LookupRepository[models.Genre]
	platforms  *repository.LookupRepository[models.Platform]
	developers *repository.LookupRepository[models.Developer]
	publishers *repository.LookupRepository[models.Publisher]
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	db := testsupport.NewDatabase(t)
	users := repository.NewUserRepository(db)
	owner := newUser(t, users, "player")

	return &fixture{
		db:         db,
		users:      users,
		owner:      owner,
		games:      repository.NewGameRepository(db, owner.ID),
		genres:     repository.NewLookupRepository[models.Genre](db, owner.ID),
		platforms:  repository.NewLookupRepository[models.Platform](db, owner.ID),
		developers: repository.NewLookupRepository[models.Developer](db, owner.ID),
		publishers: repository.NewLookupRepository[models.Publisher](db, owner.ID),
	}
}

// newUser inserts an account. The hash is a fixed string rather than a real
// bcrypt one: nothing in this package verifies a password.
func newUser(t *testing.T, users *repository.UserRepository, username string) *models.User {
	t.Helper()

	user := &models.User{Username: username, PasswordHash: "not a real hash"}
	if err := users.Create(context.Background(), user); err != nil {
		t.Fatalf("creating the %q account: %v", username, err)
	}
	return user
}

func ptr[T any](v T) *T { return &v }

func date(t *testing.T, value string) *time.Time {
	t.Helper()
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		t.Fatalf("parsing date %q: %v", value, err)
	}
	return &parsed
}

func TestLookupCRUD(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	genre := models.Genre{Name: "Metroidvania", Icon: ptr("🗺️")}
	if err := f.genres.Create(ctx, &genre); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if genre.ID == 0 {
		t.Fatal("Create did not populate the generated ID")
	}

	got, err := f.genres.Get(ctx, genre.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Name != "Metroidvania" {
		t.Errorf("Name = %q, want %q", got.Name, "Metroidvania")
	}

	// Clearing the icon must actually clear it: this is the GORM zero-value
	// trap that Select("*") in Update exists to avoid.
	got.Icon = nil
	if err := f.genres.Update(ctx, got); err != nil {
		t.Fatalf("Update: %v", err)
	}
	reloaded, err := f.genres.Get(ctx, genre.ID)
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if reloaded.Icon != nil {
		t.Errorf("Icon = %v, want nil after clearing it", *reloaded.Icon)
	}

	if err := f.genres.Delete(ctx, genre.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := f.genres.Get(ctx, genre.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Get after delete: err = %v, want ErrNotFound", err)
	}
	if err := f.genres.Delete(ctx, genre.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Delete twice: err = %v, want ErrNotFound", err)
	}
}

func TestLookupRejectsDuplicateName(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	if err := f.genres.Create(ctx, &models.Genre{Name: "Roguelike"}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// The database collation is case- and accent-insensitive, so this counts
	// as the same name.
	err := f.genres.Create(ctx, &models.Genre{Name: "roguelike"})
	if !errors.Is(err, repository.ErrDuplicate) {
		t.Fatalf("err = %v, want ErrDuplicate", err)
	}
}

func TestGameCreateWithRelations(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	platform := models.Platform{Name: "Switch"}
	if err := f.platforms.Create(ctx, &platform); err != nil {
		t.Fatalf("creating platform: %v", err)
	}
	action := models.Genre{Name: "Action"}
	adventure := models.Genre{Name: "Adventure"}
	for _, g := range []*models.Genre{&action, &adventure} {
		if err := f.genres.Create(ctx, g); err != nil {
			t.Fatalf("creating genre: %v", err)
		}
	}
	dev := models.Developer{Name: "Nintendo EPD"}
	if err := f.developers.Create(ctx, &dev); err != nil {
		t.Fatalf("creating developer: %v", err)
	}
	pub := models.Publisher{Name: "Nintendo"}
	if err := f.publishers.Create(ctx, &pub); err != nil {
		t.Fatalf("creating publisher: %v", err)
	}

	game := models.Game{
		Title:       "Tears of the Kingdom",
		Status:      models.StatusPlayed,
		Score:       ptr(9.5),
		Tagline:     ptr("Build anything, break everything"),
		PlatformID:  &platform.ID,
		ReleaseDate: date(t, "2023-05-12"),
		LoggedDate:  date(t, "2023-06-01"),
	}
	rel := repository.GameRelations{
		GenreIDs:     []uint64{action.ID, adventure.ID, action.ID}, // repeated on purpose
		DeveloperIDs: []uint64{dev.ID},
		PublisherIDs: []uint64{pub.ID},
	}
	if err := f.games.Create(ctx, &game, rel); err != nil {
		t.Fatalf("Create: %v", err)
	}

	got, err := f.games.Get(ctx, game.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(got.Genres) != 2 {
		t.Errorf("len(Genres) = %d, want 2 (the repeated id must be deduped)", len(got.Genres))
	}
	if got.Platform == nil || got.Platform.Name != "Switch" {
		t.Errorf("Platform = %+v, want Switch", got.Platform)
	}
	if got.Score == nil || *got.Score != 9.5 {
		t.Errorf("Score = %v, want 9.5", got.Score)
	}
	if len(got.Developers) != 1 || len(got.Publishers) != 1 {
		t.Errorf("developers = %d, publishers = %d, want 1 and 1", len(got.Developers), len(got.Publishers))
	}
	if got.CreatedAt.IsZero() || got.UpdatedAt.IsZero() {
		t.Error("timestamps were not populated")
	}
}

func TestGameUpdateReplacesRelationsWithoutTouchingThem(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	action := models.Genre{Name: "Action", Icon: ptr("⚔️")}
	puzzle := models.Genre{Name: "Puzzle"}
	for _, g := range []*models.Genre{&action, &puzzle} {
		if err := f.genres.Create(ctx, g); err != nil {
			t.Fatalf("creating genre: %v", err)
		}
	}

	game := models.Game{Title: "Baba Is You", Status: models.StatusPlaying, Score: ptr(8.0)}
	if err := f.games.Create(ctx, &game, repository.GameRelations{GenreIDs: []uint64{action.ID}}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Swap the genre and clear the score.
	game.Score = nil
	game.Status = models.StatusPlayed
	if err := f.games.Update(ctx, &game, repository.GameRelations{GenreIDs: []uint64{puzzle.ID}}); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, err := f.games.Get(ctx, game.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Score != nil {
		t.Errorf("Score = %v, want nil after clearing it", *got.Score)
	}
	if got.Status != models.StatusPlayed {
		t.Errorf("Status = %q, want %q", got.Status, models.StatusPlayed)
	}
	if len(got.Genres) != 1 || got.Genres[0].Name != "Puzzle" {
		t.Fatalf("Genres = %+v, want only Puzzle", got.Genres)
	}

	// The genre that was detached must still exist, untouched.
	stillThere, err := f.genres.Get(ctx, action.ID)
	if err != nil {
		t.Fatalf("the detached genre was removed: %v", err)
	}
	if stillThere.Icon == nil || *stillThere.Icon != "⚔️" {
		t.Errorf("Icon = %v, want the genre to be left untouched", stillThere.Icon)
	}
}

func TestGameDeleteCascadesJoinRows(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	genre := models.Genre{Name: "Platformer"}
	if err := f.genres.Create(ctx, &genre); err != nil {
		t.Fatalf("creating genre: %v", err)
	}
	game := models.Game{Title: "Celeste", Status: models.StatusPlayed, Score: ptr(9.0)}
	if err := f.games.Create(ctx, &game, repository.GameRelations{GenreIDs: []uint64{genre.ID}}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := f.games.Delete(ctx, game.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	var joinRows int64
	if err := f.db.Table("game_genres").Where("game_id = ?", game.ID).Count(&joinRows).Error; err != nil {
		t.Fatalf("counting join rows: %v", err)
	}
	if joinRows != 0 {
		t.Errorf("join rows = %d, want 0 after deleting the game", joinRows)
	}
	if _, err := f.genres.Get(ctx, genre.ID); err != nil {
		t.Errorf("the genre must survive deleting the game: %v", err)
	}
}

// TestPlatformDeleteIsRefusedWhileAGameUsesIt covers the rule that stops a
// delete from silently rewriting a game.
//
// The foreign key would set games.platform_id to NULL, which would be a
// surprise to whoever still had the game logged under that platform. So the
// repository refuses first, and the deletion only goes through once nothing
// points at the record.
func TestPlatformDeleteIsRefusedWhileAGameUsesIt(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	platform := models.Platform{Name: "PS5"}
	if err := f.platforms.Create(ctx, &platform); err != nil {
		t.Fatalf("creating platform: %v", err)
	}
	game := models.Game{Title: "Returnal", Status: models.StatusPlayed, PlatformID: &platform.ID}
	if err := f.games.Create(ctx, &game, repository.GameRelations{}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if err := f.platforms.Delete(ctx, platform.ID); !errors.Is(err, repository.ErrInUse) {
		t.Fatalf("Delete platform = %v, want ErrInUse", err)
	}

	inUse, err := f.platforms.InUse(ctx, platform.ID)
	if err != nil {
		t.Fatalf("InUse: %v", err)
	}
	if !inUse {
		t.Error("InUse = false for a platform a game is played on")
	}

	// The refusal left everything as it was.
	got, err := f.games.Get(ctx, game.ID)
	if err != nil {
		t.Fatalf("Get after the refused delete: %v", err)
	}
	if got.PlatformID == nil || *got.PlatformID != platform.ID {
		t.Fatalf("PlatformID = %v, want %d", got.PlatformID, platform.ID)
	}

	// Once the game no longer names it, the platform goes and the game stays.
	got.PlatformID = nil
	if err := f.games.Update(ctx, got, repository.GameRelations{}); err != nil {
		t.Fatalf("clearing the platform: %v", err)
	}
	if err := f.platforms.Delete(ctx, platform.ID); err != nil {
		t.Fatalf("Delete platform once unused: %v", err)
	}
	if _, err := f.games.Get(ctx, game.ID); err != nil {
		t.Fatalf("the game must survive deleting its platform: %v", err)
	}
}

// TestGamesAreScopedToTheirOwner is the isolation between libraries, at the
// layer that enforces it. Nothing above the repository filters by owner, so if
// this holds, nothing that goes through it can leak.
func TestGamesAreScopedToTheirOwner(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	stranger := newUser(t, f.users, "stranger")
	theirs := repository.NewGameRepository(f.db, stranger.ID)

	mine := models.Game{Title: "Hollow Knight", Status: models.StatusPlayed}
	if err := f.games.Create(ctx, &mine, repository.GameRelations{}); err != nil {
		t.Fatalf("Create: %v", err)
	}

	if mine.UserID == nil || *mine.UserID != f.owner.ID {
		t.Fatalf("UserID = %v, want %d: the repository stamps the owner", mine.UserID, f.owner.ID)
	}

	games, err := theirs.List(ctx, repository.GameFilter{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(games) != 0 {
		t.Fatalf("a stranger lists %d of somebody else's games, want 0", len(games))
	}

	stats, err := theirs.Stats(ctx, repository.GameFilter{})
	if err != nil {
		t.Fatalf("Stats: %v", err)
	}
	if stats.Count != 0 {
		t.Fatalf("a stranger counts %d of somebody else's games, want 0", stats.Count)
	}

	// Reading, writing and deleting somebody else's id all report a missing
	// row rather than a forbidden one: there is nothing there to be told about.
	if _, err := theirs.Get(ctx, mine.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Get = %v, want ErrNotFound", err)
	}
	if err := theirs.Delete(ctx, mine.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Delete = %v, want ErrNotFound", err)
	}

	theft := models.Game{ID: mine.ID, Title: "Stolen", Status: models.StatusPending}
	if err := theirs.Update(ctx, &theft, repository.GameRelations{}); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Update = %v, want ErrNotFound", err)
	}

	// Emptying a library empties nobody else's.
	if _, err := theirs.DeleteAll(ctx); err != nil {
		t.Fatalf("DeleteAll: %v", err)
	}
	if _, err := f.games.Get(ctx, mine.ID); err != nil {
		t.Fatalf("my game did not survive a stranger emptying theirs: %v", err)
	}
}

// TestLookupsAreScopedToTheirOwner is TestGamesAreScopedToTheirOwner's
// equivalent for the four simple entities, since migration 00013 made them
// one account's own records instead of shared ones.
func TestLookupsAreScopedToTheirOwner(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	stranger := newUser(t, f.users, "stranger")
	theirs := repository.NewLookupRepository[models.Genre](f.db, stranger.ID)

	mine := models.Genre{Name: "Metroidvania"}
	if err := f.genres.Create(ctx, &mine); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if mine.UserID != f.owner.ID {
		t.Fatalf("UserID = %d, want %d: the repository stamps the owner", mine.UserID, f.owner.ID)
	}

	// The same name is free to reuse: uniqueness is per owner now, not global.
	theirsGenre := models.Genre{Name: "Metroidvania"}
	if err := theirs.Create(ctx, &theirsGenre); err != nil {
		t.Fatalf("a stranger could not create a genre with a name I already use: %v", err)
	}

	listed, err := theirs.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != theirsGenre.ID {
		t.Fatalf("a stranger lists %+v, want only their own genre", listed)
	}

	if _, err := theirs.Get(ctx, mine.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Get = %v, want ErrNotFound", err)
	}
	if err := theirs.Delete(ctx, mine.ID); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Delete = %v, want ErrNotFound", err)
	}

	theft := models.Genre{ID: mine.ID, Name: "Stolen"}
	if err := theirs.Update(ctx, &theft); !errors.Is(err, repository.ErrNotFound) {
		t.Errorf("Update = %v, want ErrNotFound", err)
	}
	stillMine, err := f.genres.Get(ctx, mine.ID)
	if err != nil {
		t.Fatalf("my genre did not survive a stranger's attempted update: %v", err)
	}
	if stillMine.Name != "Metroidvania" {
		t.Errorf("Name = %q, want it untouched", stillMine.Name)
	}
}

// TestGameRejectsAnotherAccountsLookup covers the other half of the isolation:
// a game must not be able to name a genre, developer, publisher or platform
// it does not own, now that those are private records rather than shared ones.
func TestGameRejectsAnotherAccountsLookup(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	stranger := newUser(t, f.users, "stranger")
	theirGenres := repository.NewLookupRepository[models.Genre](f.db, stranger.ID)
	theirPlatforms := repository.NewLookupRepository[models.Platform](f.db, stranger.ID)

	theirGenre := models.Genre{Name: "Roguelike"}
	if err := theirGenres.Create(ctx, &theirGenre); err != nil {
		t.Fatalf("creating the stranger's genre: %v", err)
	}
	theirPlatform := models.Platform{Name: "PS5"}
	if err := theirPlatforms.Create(ctx, &theirPlatform); err != nil {
		t.Fatalf("creating the stranger's platform: %v", err)
	}

	game := models.Game{Title: "Returnal", Status: models.StatusPlayed}
	err := f.games.Create(ctx, &game, repository.GameRelations{GenreIDs: []uint64{theirGenre.ID}})
	if !errors.Is(err, repository.ErrInvalidReference) {
		t.Fatalf("Create with a stranger's genre = %v, want ErrInvalidReference", err)
	}

	game.PlatformID = &theirPlatform.ID
	err = f.games.Create(ctx, &game, repository.GameRelations{})
	if !errors.Is(err, repository.ErrInvalidReference) {
		t.Fatalf("Create with a stranger's platform = %v, want ErrInvalidReference", err)
	}
}
