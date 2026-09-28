package handlers_test

import (
	"net/http"
	"testing"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// TestLookupCRUD walks the full life cycle of a genre. The other three simple
// entities share the same generic implementation, so the differences worth
// testing are the ones below.
func TestLookupCRUD(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	icon := "🗺️"
	created := request(t, handler, http.MethodPost, "/api/genres", map[string]any{
		"name": "Metroidvania",
		"icon": icon,
	})
	expectStatus(t, created, http.StatusCreated, "creating a genre")

	var genre models.Genre
	decode(t, created, &genre)
	if genre.ID == 0 {
		t.Fatal("the created genre came back without an id")
	}
	if genre.Name != "Metroidvania" || genre.Icon == nil || *genre.Icon != icon {
		t.Errorf("created genre = %+v, want the submitted name and icon", genre)
	}

	listed := request(t, handler, http.MethodGet, "/api/genres", nil)
	expectStatus(t, listed, http.StatusOK, "listing genres")

	var genres []models.Genre
	decode(t, listed, &genres)
	if len(genres) != 1 {
		t.Fatalf("listed %d genres, want 1", len(genres))
	}

	// Replacing with the same values must not be mistaken for a missing row,
	// which is what MariaDB reports without clientFoundRows in the DSN.
	unchanged := request(t, handler, http.MethodPut, itemPath("/api/genres", genre.ID), map[string]any{
		"name": "Metroidvania",
		"icon": icon,
	})
	expectStatus(t, unchanged, http.StatusOK, "replacing a genre with the values it already has")

	// An icon left out of the body is cleared, not kept.
	replaced := request(t, handler, http.MethodPut, itemPath("/api/genres", genre.ID), map[string]any{
		"name": "Platformer",
	})
	expectStatus(t, replaced, http.StatusOK, "replacing a genre")

	var updated models.Genre
	decode(t, replaced, &updated)
	if updated.Name != "Platformer" {
		t.Errorf("name = %q, want %q", updated.Name, "Platformer")
	}
	if updated.Icon != nil {
		t.Errorf("icon = %q, want it cleared", *updated.Icon)
	}

	deleted := request(t, handler, http.MethodDelete, itemPath("/api/genres", genre.ID), nil)
	expectStatus(t, deleted, http.StatusNoContent, "deleting a genre")

	gone := request(t, handler, http.MethodGet, itemPath("/api/genres", genre.ID), nil)
	expectStatus(t, gone, http.StatusNotFound, "reading a deleted genre")
}

func TestLookupRejectsADuplicateName(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	first := request(t, handler, http.MethodPost, "/api/platforms", map[string]any{"name": "Nintendo Switch"})
	expectStatus(t, first, http.StatusCreated, "creating a platform")

	// The name columns collate case- and accent-insensitively, so this is the
	// same name as far as the unique index is concerned.
	second := request(t, handler, http.MethodPost, "/api/platforms", map[string]any{"name": "nintendo switch"})
	expectStatus(t, second, http.StatusConflict, "creating a platform that already exists")
}

func TestLookupRejectsAnEmptyName(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	// Validation happens before the handler runs: the schema generated from
	// the Go types is the one enforcing it.
	rejected := request(t, handler, http.MethodPost, "/api/developers", map[string]any{"name": ""})
	expectStatus(t, rejected, http.StatusUnprocessableEntity, "creating a developer with no name")
}

func TestLookupReportsAMissingRecord(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	missing := request(t, handler, http.MethodPut, "/api/publishers/404", map[string]any{"name": "Nobody"})
	expectStatus(t, missing, http.StatusNotFound, "replacing a publisher that does not exist")
}

func TestPlatformColorRoundTrips(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	created := request(t, handler, http.MethodPost, "/api/platforms", map[string]any{
		"name":  "Nintendo Switch 2",
		"color": "#e60012",
	})
	expectStatus(t, created, http.StatusCreated, "creating a platform with a color")

	var platform models.Platform
	decode(t, created, &platform)
	if platform.Color == nil || *platform.Color != "#e60012" {
		t.Errorf("color = %v, want #e60012", platform.Color)
	}
}

// TestLookupColorIsIgnoredOutsidePlatforms guards the trade-off documented on
// lookupBody.Color: the field exists in every one of the four bodies, but
// only platforms has a column for it.
func TestLookupColorIsIgnoredOutsidePlatforms(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	created := request(t, handler, http.MethodPost, "/api/genres", map[string]any{
		"name":  "Metroidvania",
		"color": "#e60012",
	})
	expectStatus(t, created, http.StatusCreated, "creating a genre with a color")

	var genre models.Genre
	decode(t, created, &genre)
	if genre.ID == 0 {
		t.Fatal("the created genre came back without an id")
	}
}
