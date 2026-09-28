package handlers_test

import (
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/service"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// exportLibrary reads the whole library back through the API.
func exportLibrary(t *testing.T, handler http.Handler) service.Document {
	t.Helper()

	rec := request(t, handler, http.MethodGet, "/api/export", nil)
	expectStatus(t, rec, http.StatusOK, "exporting the library")

	var document service.Document
	decode(t, rec, &document)
	return document
}

// importLibrary posts a document and returns the report.
func importLibrary(t *testing.T, handler http.Handler, target string, body any) service.ImportReport {
	t.Helper()

	rec := request(t, handler, http.MethodPost, target, body)
	expectStatus(t, rec, http.StatusOK, "importing "+target)

	var report service.ImportReport
	decode(t, rec, &report)
	return report
}

// listGames reads the games back through the API.
func listGames(t *testing.T, handler http.Handler) []models.Game {
	t.Helper()

	rec := request(t, handler, http.MethodGet, "/api/games", nil)
	expectStatus(t, rec, http.StatusOK, "listing games")

	var games []models.Game
	decode(t, rec, &games)
	return games
}

// A library that is exported and imported back has to come out the same, or
// the format is not a backup.
func TestExportAndImportRoundTrip(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	platformID := createLookup(t, handler, "/api/platforms", "Nintendo Switch")
	genreID := createLookup(t, handler, "/api/genres", "Metroidvania")
	developerID := createLookup(t, handler, "/api/developers", "Team Cherry")
	publisherID := createLookup(t, handler, "/api/publishers", "Team Cherry")

	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":           "Hollow Knight",
		"status":          models.StatusPlayed,
		"position":        1,
		"score":           9.2,
		"tagline":         "Lonely bug, big map",
		"notes":           "One of the good ones.",
		"cover_image_url": "https://example.com/hk.png",
		"release_date":    "2017-02-24T00:00:00Z",
		"logged_date":     "2026-01-15T00:00:00Z",
		"platform_id":     platformID,
		"genre_ids":       []uint64{genreID},
		"developer_ids":   []uint64{developerID},
		"publisher_ids":   []uint64{publisherID},
	})
	expectStatus(t, created, http.StatusCreated, "creating a game")

	exported := exportLibrary(t, handler)

	if exported.Version != service.FormatVersion {
		t.Errorf("version = %d, want %d", exported.Version, service.FormatVersion)
	}
	if len(exported.Games) != 1 {
		t.Fatalf("exported %d games, want 1", len(exported.Games))
	}

	game := exported.Games[0]
	if game.Platform == nil || *game.Platform != "Nintendo Switch" {
		t.Errorf("platform = %v, want it written by name", game.Platform)
	}
	if len(game.Genres) != 1 || game.Genres[0] != "Metroidvania" {
		t.Errorf("genres = %v, want them written by name", game.Genres)
	}
	if want := time.Date(2017, time.February, 24, 0, 0, 0, 0, time.UTC); game.ReleaseDate == nil ||
		!game.ReleaseDate.Time.Equal(want) {
		t.Errorf("release_date = %+v, want %v", game.ReleaseDate, want)
	}

	// A browser following the link saves a file rather than painting JSON.
	rec := request(t, handler, http.MethodGet, "/api/export", nil)
	if disposition := rec.Header().Get("Content-Disposition"); disposition == "" {
		t.Error("the export carries no Content-Disposition header")
	}

	// Loading the export over the library it came from has to leave it as it
	// was, whichever mode it runs in.
	for _, mode := range []string{"replace", "merge"} {
		report := importLibrary(t, handler, "/api/import?mode="+mode, exported)
		if len(report.Skipped) != 0 {
			t.Errorf("%s: skipped %+v, want nothing skipped", mode, report.Skipped)
		}

		reexported := exportLibrary(t, handler)

		exported.ExportedAt = time.Time{}
		reexported.ExportedAt = time.Time{}
		if !reflect.DeepEqual(exported, reexported) {
			t.Errorf("%s: the library changed across a round trip\nbefore: %+v\nafter:  %+v",
				mode, exported, reexported)
		}
	}
}

// A platform's colour is the one field the four simple entities do not share
// (models.Platform), so it has to be carried and restored by hand rather than
// by the same code path as name and icon.
func TestExportAndImportKeepAPlatformsColor(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	created := request(t, handler, http.MethodPost, "/api/platforms", map[string]any{
		"name":  "Nintendo Switch 2",
		"color": "#e60012",
	})
	expectStatus(t, created, http.StatusCreated, "creating a platform with a color")

	exported := exportLibrary(t, handler)
	if len(exported.Platforms) != 1 || exported.Platforms[0].Color == nil ||
		*exported.Platforms[0].Color != "#e60012" {
		t.Fatalf("platforms = %+v, want the color exported", exported.Platforms)
	}

	// A genre has no color column at all; the export must not invent one.
	createLookup(t, handler, "/api/genres", "Metroidvania")
	exported = exportLibrary(t, handler)
	if len(exported.Genres) != 1 || exported.Genres[0].Color != nil {
		t.Fatalf("genres = %+v, want no color on an entity that has none", exported.Genres)
	}

	// Restoring the export onto an empty library must bring the color back,
	// including through the alias a spreadsheet would use.
	fresh := newRouter(t, testsupport.NewDatabase(t), false)
	importLibrary(t, fresh, "/api/import", exported)

	var platforms []struct {
		Name  string  `json:"name"`
		Color *string `json:"color"`
	}
	rec := request(t, fresh, http.MethodGet, "/api/platforms", nil)
	expectStatus(t, rec, http.StatusOK, "listing platforms after an import")
	decode(t, rec, &platforms)
	if len(platforms) != 1 || platforms[0].Color == nil || *platforms[0].Color != "#e60012" {
		t.Fatalf("platforms = %+v, want the color restored", platforms)
	}

	importLibrary(t, fresh, "/api/import", map[string]any{
		"platforms": []map[string]any{{"name": "Nintendo Switch 2", "colour": "#1a1a1a"}},
	})
	rec = request(t, fresh, http.MethodGet, "/api/platforms", nil)
	expectStatus(t, rec, http.StatusOK, "listing platforms after updating the color by its alias")
	decode(t, rec, &platforms)
	if len(platforms) != 1 || platforms[0].Color == nil || *platforms[0].Color != "#1a1a1a" {
		t.Fatalf("platforms = %+v, want the color updated through the \"colour\" alias", platforms)
	}
}

// The shortcut the whole format is designed around: a file holding nothing but
// games, in whatever shape it left the other tool in, is a complete import.
func TestImportCreatesWhatTheGamesName(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	report := importLibrary(t, handler, "/api/import", []map[string]any{
		{
			"Nombre":               "Hollow Knight",
			"Estado":               "Terminado",
			"Puntuación":           "9,2",
			"Plataforma":           "Nintendo Switch",
			"Tags":                 "Metroidvania, Action",
			"Desarrollador":        "Team Cherry",
			"Fecha de lanzamiento": "24/02/2017",
		},
		{
			"title":    "Celeste",
			"status":   "backlog",
			"platform": "Nintendo Switch",
			"genres":   []string{"Platformer"},
		},
	})

	if report.Created.Games != 2 {
		t.Errorf("created %d games, want 2", report.Created.Games)
	}
	// The platform is named by both games and has to be created once.
	if report.Created.Platforms != 1 {
		t.Errorf("created %d platforms, want 1", report.Created.Platforms)
	}
	if report.Created.Genres != 3 {
		t.Errorf("created %d genres, want 3", report.Created.Genres)
	}
	if report.Created.Developers != 1 {
		t.Errorf("created %d developers, want 1", report.Created.Developers)
	}

	games := listGames(t, handler)
	if len(games) != 2 {
		t.Fatalf("the library holds %d games, want 2", len(games))
	}

	byTitle := map[string]models.Game{}
	for _, game := range games {
		byTitle[game.Title] = game
	}

	hollowKnight := byTitle["Hollow Knight"]
	if hollowKnight.Status != models.StatusPlayed {
		t.Errorf("status = %q, want %q read from Terminado", hollowKnight.Status, models.StatusPlayed)
	}
	if hollowKnight.Score == nil || *hollowKnight.Score != 9.2 {
		t.Errorf("score = %v, want 9.2 read from a string with a comma", hollowKnight.Score)
	}
	if hollowKnight.Platform == nil || hollowKnight.Platform.Name != "Nintendo Switch" {
		t.Errorf("platform = %+v, want the one the entry named", hollowKnight.Platform)
	}
	if len(hollowKnight.Genres) != 2 {
		t.Errorf("genres = %+v, want the two the comma-separated list held", hollowKnight.Genres)
	}
	if hollowKnight.ReleaseDate == nil ||
		!hollowKnight.ReleaseDate.Equal(time.Date(2017, time.February, 24, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("release_date = %v, want the date read day first", hollowKnight.ReleaseDate)
	}
	if byTitle["Celeste"].Status != models.StatusPending {
		t.Errorf("status = %q, want %q read from backlog", byTitle["Celeste"].Status, models.StatusPending)
	}

	// Importing the same file again matches what is there instead of
	// duplicating it, which is what makes the format safe to re-run.
	again := importLibrary(t, handler, "/api/import", []map[string]any{
		{"title": "hollow knight", "score": 9.5},
	})
	if again.Created.Games != 0 || again.Updated.Games != 1 {
		t.Errorf("created %d and updated %d games, want 0 and 1 matched by title ignoring case",
			again.Created.Games, again.Updated.Games)
	}
	if games := listGames(t, handler); len(games) != 2 {
		t.Errorf("the library holds %d games, want the same 2", len(games))
	}
}

// A merge writes the fields the document carries and leaves the rest of the
// game alone: that is what turns a spreadsheet of new scores into an update.
func TestImportMergeOnlyWritesWhatTheDocumentCarries(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	genreID := createLookup(t, handler, "/api/genres", "Metroidvania")
	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":     "Hollow Knight",
		"status":    models.StatusPlaying,
		"position":  1,
		"score":     9.2,
		"tagline":   "Lonely bug, big map",
		"genre_ids": []uint64{genreID},
	})
	expectStatus(t, created, http.StatusCreated, "creating a game")

	importLibrary(t, handler, "/api/import", map[string]any{
		"games": []map[string]any{{
			"title":  "Hollow Knight",
			"status": "played",
			"notes":  "Finished it at last.",
		}},
	})

	games := listGames(t, handler)
	if len(games) != 1 {
		t.Fatalf("the library holds %d games, want 1", len(games))
	}

	game := games[0]
	if game.Status != models.StatusPlayed {
		t.Errorf("status = %q, want it written over", game.Status)
	}
	if game.Notes == nil {
		t.Error("the notes the document carried were not written")
	}
	if game.Score == nil || *game.Score != 9.2 {
		t.Errorf("score = %v, want the stored one kept", game.Score)
	}
	if game.Tagline == nil {
		t.Error("the tagline was cleared by a document that said nothing about it")
	}
	if len(game.Genres) != 1 {
		t.Errorf("genres = %+v, want the stored one kept", game.Genres)
	}

	// A field sent empty, on the other hand, is a field being cleared.
	importLibrary(t, handler, "/api/import", map[string]any{
		"games": []map[string]any{{"title": "Hollow Knight", "tagline": "", "genres": []string{}}},
	})

	game = listGames(t, handler)[0]
	if game.Tagline != nil {
		t.Errorf("tagline = %v, want it cleared by the empty string", *game.Tagline)
	}
	if len(game.Genres) != 0 {
		t.Errorf("genres = %+v, want them cleared by the empty list", game.Genres)
	}
}

// A permissive import still has to be honest about what it did, and has to be
// rehearsable before it is run.
func TestImportReportsWhatItCannotReadAndCanBeRehearsed(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	document := map[string]any{
		"games": []map[string]any{
			{"title": "Celeste", "status": "no idea"},
			{"status": "played"},
			{"title": "Tunic"},
		},
		"genres": []any{"RPG", map[string]any{"name": "   "}},
	}

	rehearsal := importLibrary(t, handler, "/api/import?dry_run=true", document)

	if !rehearsal.DryRun {
		t.Error("the report does not say it was a rehearsal")
	}
	if rehearsal.Created.Games != 2 {
		t.Errorf("the rehearsal created %d games, want the 2 it would have", rehearsal.Created.Games)
	}
	if len(rehearsal.Skipped) != 2 {
		t.Errorf("skipped = %+v, want the game with no title and the genre with no name", rehearsal.Skipped)
	}
	if len(rehearsal.Warnings) != 1 {
		t.Errorf("warnings = %+v, want the one about a status that means nothing", rehearsal.Warnings)
	}
	if games := listGames(t, handler); len(games) != 0 {
		t.Errorf("a rehearsal wrote %d games, want none", len(games))
	}

	report := importLibrary(t, handler, "/api/import", document)
	if report.Created.Games != 2 {
		t.Errorf("created %d games, want 2", report.Created.Games)
	}

	games := listGames(t, handler)
	if len(games) != 2 {
		t.Fatalf("the library holds %d games, want the 2 readable entries", len(games))
	}
	// An entry the importer could not read does not stop the ones it could.
	for _, game := range games {
		if game.Status != models.StatusPending {
			t.Errorf("%s: status = %q, want the default %q", game.Title, game.Status, models.StatusPending)
		}
	}
}

// The replace mode is the other half of a backup: what comes out is exactly
// what went in, with whatever was there gone.
// TestImportReplaceEmptiesTheGamesOnly covers what replace means now that
// there is more than one library.
//
// It empties the caller's games and nothing else. The genres, developers,
// publishers and platforms survive too, same as a merge: at worst it leaves
// an unused entry in a dropdown, which is its own deliberate delete.
func TestImportReplaceEmptiesTheGamesOnly(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	createLookup(t, handler, "/api/genres", "Shooter")
	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":    "Doom",
		"status":   models.StatusPlayed,
		"position": 1,
	})
	expectStatus(t, created, http.StatusCreated, "creating a game")

	report := importLibrary(t, handler, "/api/import?mode=replace", map[string]any{
		"games": []map[string]any{{"title": "Celeste", "status": "played"}},
	})

	if report.Deleted.Games != 1 {
		t.Errorf("deleted games = %d, want the one that was there", report.Deleted.Games)
	}
	if report.Deleted.Genres != 0 {
		t.Errorf("deleted genres = %d, want 0: replace only empties games", report.Deleted.Genres)
	}

	games := listGames(t, handler)
	if len(games) != 1 || games[0].Title != "Celeste" {
		t.Errorf("the library holds %+v, want only the imported game", games)
	}

	var genres []struct {
		Name string `json:"name"`
	}
	rec := request(t, handler, http.MethodGet, "/api/genres", nil)
	expectStatus(t, rec, http.StatusOK, "listing the genres after a replace")
	decode(t, rec, &genres)
	if len(genres) != 1 || genres[0].Name != "Shooter" {
		t.Errorf("the genres are %+v, want the one that was there to survive", genres)
	}
}
