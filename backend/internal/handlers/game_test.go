package handlers_test

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// itemPath builds the path of a single record.
func itemPath(collection string, id uint64) string {
	return collection + "/" + strconv.FormatUint(id, 10)
}

// createLookup creates one of the simple entities and returns its id.
func createLookup(t *testing.T, handler http.Handler, collection, name string) uint64 {
	t.Helper()

	rec := request(t, handler, http.MethodPost, collection, map[string]any{"name": name})
	expectStatus(t, rec, http.StatusCreated, "creating "+name)

	var created struct {
		ID uint64 `json:"id"`
	}
	decode(t, rec, &created)
	return created.ID
}

func TestGameCRUD(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	platformID := createLookup(t, handler, "/api/platforms", "Nintendo Switch")
	genreID := createLookup(t, handler, "/api/genres", "Metroidvania")
	developerID := createLookup(t, handler, "/api/developers", "Team Cherry")

	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":         "Hollow Knight",
		"status":        models.StatusPlaying,
		"position":      1,
		"score":         9.2,
		"tagline":       "Lonely bug, big map",
		"logged_date":   "2026-01-15T00:00:00Z",
		"platform_id":   platformID,
		"genre_ids":     []uint64{genreID},
		"developer_ids": []uint64{developerID},
	})
	expectStatus(t, created, http.StatusCreated, "creating a game")

	var game models.Game
	decode(t, created, &game)
	if game.ID == 0 {
		t.Fatal("the created game came back without an id")
	}
	// A write answers with the same shape a read does: relations loaded.
	if game.Platform == nil || game.Platform.Name != "Nintendo Switch" {
		t.Errorf("platform = %+v, want it loaded", game.Platform)
	}
	if len(game.Genres) != 1 || len(game.Developers) != 1 {
		t.Errorf("relations = %d genres and %d developers, want 1 and 1", len(game.Genres), len(game.Developers))
	}
	if game.Score == nil || *game.Score != 9.2 {
		t.Errorf("score = %v, want 9.2", game.Score)
	}

	read := request(t, handler, http.MethodGet, itemPath("/api/games", game.ID), nil)
	expectStatus(t, read, http.StatusOK, "reading a game")

	// No filters: every game, which is also the case that would break if an
	// omitted enum parameter were validated as if it had been sent.
	listed := request(t, handler, http.MethodGet, "/api/games", nil)
	expectStatus(t, listed, http.StatusOK, "listing games")

	var games []models.Game
	decode(t, listed, &games)
	if len(games) != 1 {
		t.Fatalf("listed %d games, want 1", len(games))
	}

	filtered := request(t, handler, http.MethodGet, "/api/games?status=played&sort=score&order=desc", nil)
	expectStatus(t, filtered, http.StatusOK, "listing played games")

	var played []models.Game
	decode(t, filtered, &played)
	if len(played) != 0 {
		t.Errorf("listed %d played games, want 0", len(played))
	}

	byGenre := request(t, handler, http.MethodGet, "/api/games?genre_id="+strconv.FormatUint(genreID, 10), nil)
	expectStatus(t, byGenre, http.StatusOK, "listing games of a genre")

	var withGenre []models.Game
	decode(t, byGenre, &withGenre)
	if len(withGenre) != 1 {
		t.Errorf("listed %d games of the genre, want 1", len(withGenre))
	}

	// Replacing clears what the body leaves out: the tagline here.
	replaced := request(t, handler, http.MethodPut, itemPath("/api/games", game.ID), map[string]any{
		"title":     "Hollow Knight",
		"status":    models.StatusPlayed,
		"position":  1,
		"score":     9.5,
		"genre_ids": []uint64{genreID},
	})
	expectStatus(t, replaced, http.StatusOK, "replacing a game")

	var updated models.Game
	decode(t, replaced, &updated)
	if updated.Status != models.StatusPlayed {
		t.Errorf("status = %q, want %q", updated.Status, models.StatusPlayed)
	}
	if updated.Tagline != nil {
		t.Errorf("tagline = %q, want it cleared", *updated.Tagline)
	}
	if updated.Platform != nil {
		t.Errorf("platform = %+v, want it cleared", updated.Platform)
	}
	if len(updated.Developers) != 0 {
		t.Errorf("developers = %d, want the relation replaced by the ids sent", len(updated.Developers))
	}

	stats := request(t, handler, http.MethodGet, "/api/games/stats", nil)
	expectStatus(t, stats, http.StatusOK, "aggregating games")

	var aggregates repository.GameStats
	decode(t, stats, &aggregates)
	if aggregates.Count != 1 {
		t.Errorf("count = %d, want 1", aggregates.Count)
	}
	if aggregates.AverageScore == nil || *aggregates.AverageScore != 9.5 {
		t.Errorf("average score = %v, want 9.5", aggregates.AverageScore)
	}

	deleted := request(t, handler, http.MethodDelete, itemPath("/api/games", game.ID), nil)
	expectStatus(t, deleted, http.StatusNoContent, "deleting a game")

	gone := request(t, handler, http.MethodGet, itemPath("/api/games", game.ID), nil)
	expectStatus(t, gone, http.StatusNotFound, "reading a deleted game")
}

// TestGameAcceptsARelativeCoverImageURL guards against the schema requiring
// an absolute URI again: a cover almost always points at this deployment's
// own /api/images/{name}, which has no scheme, and rejecting that would break
// every upload rather than only a hand-typed external link.
func TestGameAcceptsARelativeCoverImageURL(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":           "Celeste",
		"status":          models.StatusPlayed,
		"position":        1,
		"cover_image_url": "/api/images/deadbeef.jpg",
		"release_date":    "2018-01-25T00:00:00Z",
	})
	expectStatus(t, created, http.StatusCreated, "creating a game with a relative cover image URL")

	var game models.Game
	decode(t, created, &game)
	if game.CoverImageURL == nil || *game.CoverImageURL != "/api/images/deadbeef.jpg" {
		t.Errorf("cover_image_url = %v, want the relative path unchanged", game.CoverImageURL)
	}
	if game.ReleaseDate == nil {
		t.Error("release_date = nil, want it set")
	}
}

// TestGamePositionIsRequiredAndRoundTrips guards the replace-semantics trap:
// position has no omitempty, so a client that forgets it gets a 422 rather
// than silently resetting the board's manual order to zero.
func TestGamePositionIsRequiredAndRoundTrips(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	missing := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":  "Celeste",
		"status": models.StatusPlayed,
	})
	expectStatus(t, missing, http.StatusUnprocessableEntity, "creating a game with no position")

	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":    "Celeste",
		"status":   models.StatusPlayed,
		"position": 4.5,
	})
	expectStatus(t, created, http.StatusCreated, "creating a game with a position")

	var game models.Game
	decode(t, created, &game)
	if game.Position != 4.5 {
		t.Errorf("position = %v, want 4.5", game.Position)
	}

	moved := request(t, handler, http.MethodPut, itemPath("/api/games", game.ID), map[string]any{
		"title":    "Celeste",
		"status":   models.StatusPlayed,
		"position": 2.25,
	})
	expectStatus(t, moved, http.StatusOK, "moving a game")

	var updated models.Game
	decode(t, moved, &updated)
	if updated.Position != 2.25 {
		t.Errorf("position = %v, want 2.25", updated.Position)
	}
}

func TestGameRejectsAnUnknownStatus(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	// "finished" is not one of models.Statuses(), and the enum in the schema
	// is built from that list, so the request never reaches the database.
	rejected := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":  "Celeste",
		"status": "finished",
	})
	expectStatus(t, rejected, http.StatusUnprocessableEntity, "creating a game with an unknown status")
}

func TestGameRejectsAScoreOutOfRange(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	rejected := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":  "Celeste",
		"status": models.StatusPlayed,
		"score":  11,
	})
	expectStatus(t, rejected, http.StatusUnprocessableEntity, "creating a game scored above 10")
}

func TestGameRejectsAMissingRelation(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	// The id is well formed, so only the database can reject it: the foreign
	// key failure has to come back as a 422 rather than as a 500.
	rejected := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":       "Celeste",
		"status":      models.StatusPending,
		"platform_id": 404,
	})
	expectStatus(t, rejected, http.StatusUnprocessableEntity, "creating a game on a platform that does not exist")
}

func TestListGamesRejectsAnUnknownSortField(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	rejected := request(t, handler, http.MethodGet, "/api/games?sort=drop%20table", nil)
	expectStatus(t, rejected, http.StatusUnprocessableEntity, "sorting by an unknown field")
}
