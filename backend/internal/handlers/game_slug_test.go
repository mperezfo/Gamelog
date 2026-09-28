package handlers_test

import (
	"net/http"
	"testing"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

func TestGameSlugIsDerivedAndUsableAsRef(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title": "(the) Gnorp Apologue", "status": models.StatusPending, "position": 1,
	})
	expectStatus(t, created, http.StatusCreated, "creating a game")

	var game models.Game
	decode(t, created, &game)
	if game.Slug != "the-gnorp-apologue" {
		t.Errorf("slug = %q, want %q", game.Slug, "the-gnorp-apologue")
	}

	byRef := request(t, handler, http.MethodGet, "/api/games/"+game.Slug, nil)
	expectStatus(t, byRef, http.StatusOK, "reading a game by its slug")

	var reread models.Game
	decode(t, byRef, &reread)
	if reread.ID != game.ID {
		t.Errorf("read by slug returned id %d, want %d", reread.ID, game.ID)
	}
}

// TestGameSlugCollisionsGetSuffixed guards the exact behaviour a second
// "Doom" in the same library relies on: it gets its own working URL instead
// of colliding with the first one's.
func TestGameSlugCollisionsGetSuffixed(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	first := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title": "Doom", "status": models.StatusPlayed, "position": 1,
	})
	expectStatus(t, first, http.StatusCreated, "creating the first Doom")
	var firstGame models.Game
	decode(t, first, &firstGame)
	if firstGame.Slug != "doom" {
		t.Fatalf("first slug = %q, want %q", firstGame.Slug, "doom")
	}

	second := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title": "DOOM", "status": models.StatusPending, "position": 1,
	})
	expectStatus(t, second, http.StatusCreated, "creating the second Doom")
	var secondGame models.Game
	decode(t, second, &secondGame)
	if secondGame.Slug != "doom-2" {
		t.Errorf("second slug = %q, want %q", secondGame.Slug, "doom-2")
	}

	// Both are still reachable by their own slug.
	expectStatus(t, request(t, handler, http.MethodGet, "/api/games/doom", nil), http.StatusOK, "reading doom")
	expectStatus(t, request(t, handler, http.MethodGet, "/api/games/doom-2", nil), http.StatusOK, "reading doom-2")
}

// TestGameSlugFollowsARename is the "always in sync" choice: the slug tracks
// the title, so a renamed game answers at its new slug and not its old one.
func TestGameSlugFollowsARename(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title": "Gnorp Apologue", "status": models.StatusPlaying, "position": 1,
	})
	expectStatus(t, created, http.StatusCreated, "creating a game")
	var game models.Game
	decode(t, created, &game)

	renamed := request(t, handler, http.MethodPut, itemPath("/api/games", game.ID), map[string]any{
		"title": "Gnorp Apologue Deluxe", "status": models.StatusPlaying, "position": 1,
	})
	expectStatus(t, renamed, http.StatusOK, "renaming a game")
	var updated models.Game
	decode(t, renamed, &updated)
	if updated.Slug != "gnorp-apologue-deluxe" {
		t.Errorf("slug after rename = %q, want %q", updated.Slug, "gnorp-apologue-deluxe")
	}

	gone := request(t, handler, http.MethodGet, "/api/games/gnorp-apologue", nil)
	expectStatus(t, gone, http.StatusNotFound, "reading the game by its old slug")
}

// TestGameSlugsDoNotCollideAcrossLibraries checks the unique index is scoped
// to (user_id, slug): two accounts are each free to have their own "doom".
func TestGameSlugsDoNotCollideAcrossLibraries(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)

	alice := signedIn(t, bare, db, "alice", false)
	bob := signedIn(t, bare, db, "bob", false)

	aliceGame := request(t, alice, http.MethodPost, "/api/games", map[string]any{
		"title": "Doom", "status": models.StatusPlayed, "position": 1,
	})
	expectStatus(t, aliceGame, http.StatusCreated, "alice creating Doom")

	bobGame := request(t, bob, http.MethodPost, "/api/games", map[string]any{
		"title": "Doom", "status": models.StatusPlayed, "position": 1,
	})
	expectStatus(t, bobGame, http.StatusCreated, "bob creating Doom")

	var bobsDoom models.Game
	decode(t, bobGame, &bobsDoom)
	if bobsDoom.Slug != "doom" {
		t.Errorf("bob's slug = %q, want %q (his own library, no collision with alice's)", bobsDoom.Slug, "doom")
	}
}
