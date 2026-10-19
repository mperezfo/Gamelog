package service_test

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/mperezfo/gamelog/internal/service"
)

// decodeDocument reads an import document the way the API does.
func decodeDocument(t *testing.T, body string) service.ImportDocument {
	t.Helper()

	var document service.ImportDocument
	if err := json.Unmarshal([]byte(body), &document); err != nil {
		t.Fatalf("decoding the document: %v; body: %s", err, body)
	}
	return document
}

// onlyGame reads a document and returns its single game.
func onlyGame(t *testing.T, body string) service.ImportGame {
	t.Helper()

	document := decodeDocument(t, body)
	if len(document.Games) != 1 {
		t.Fatalf("decoded %d games, want 1", len(document.Games))
	}
	return document.Games[0]
}

func TestImportReadsTheCanonicalDocument(t *testing.T) {
	document := decodeDocument(t, `{
		"version": 1,
		"platforms": [{"name": "Nintendo Switch", "icon": "🎮"}],
		"genres": [{"name": "Metroidvania"}],
		"games": [{
			"title": "Hollow Knight",
			"status": "played",
			"score": 9.2,
			"release_date": "2017-02-24",
			"platform": "Nintendo Switch",
			"genres": ["Metroidvania"]
		}]
	}`)

	if len(document.Platforms) != 1 || document.Platforms[0].Name == nil ||
		*document.Platforms[0].Name != "Nintendo Switch" {
		t.Errorf("platforms = %+v, want one named Nintendo Switch", document.Platforms)
	}
	if len(document.Genres) != 1 {
		t.Errorf("genres = %+v, want one", document.Genres)
	}

	game := document.Games[0]
	if game.Title == nil || *game.Title != "Hollow Knight" {
		t.Errorf("title = %v, want Hollow Knight", game.Title)
	}
	if game.Score == nil || game.Score.Value != 9.2 {
		t.Errorf("score = %+v, want 9.2", game.Score)
	}
	if want := time.Date(2017, time.February, 24, 0, 0, 0, 0, time.UTC); game.ReleaseDate == nil ||
		!game.ReleaseDate.Time.Equal(want) {
		t.Errorf("release_date = %+v, want %v", game.ReleaseDate, want)
	}
	if len(game.Genres) != 1 || game.Genres[0] != "Metroidvania" {
		t.Errorf("genres = %v, want [Metroidvania]", game.Genres)
	}
}

// A database exported on its own is an array of rows, with no envelope around
// it. It is the likeliest thing a user ends up with, so it has to work.
func TestImportReadsABareArrayOfGames(t *testing.T) {
	document := decodeDocument(t, `[{"title": "Celeste"}, {"title": "Tunic"}]`)

	if len(document.Games) != 2 {
		t.Fatalf("decoded %d games, want 2", len(document.Games))
	}
	if *document.Games[0].Title != "Celeste" {
		t.Errorf("first game = %v, want Celeste", *document.Games[0].Title)
	}
}

// The point of the alias tables: a file whose columns are named the way the
// user named them in Notion, in Spanish, imports without being renamed first.
func TestImportReadsFieldsUnderTheirAliases(t *testing.T) {
	game := onlyGame(t, `{"juegos": [{
		"Nombre": "Hollow Knight",
		"Estado": "Terminado",
		"Puntuación": "9,2",
		"Cuatro palabras": "Lonely bug, big map",
		"Plataforma": "Nintendo Switch",
		"Tags": "Metroidvania, Acción",
		"Fecha de lanzamiento": "24/02/2017",
		"Portada": "https://example.com/hk.png",
		"Rollup de otra tabla": {"whatever": [1, 2]}
	}]}`)

	if game.Title == nil || *game.Title != "Hollow Knight" {
		t.Errorf("title = %v, want Hollow Knight", game.Title)
	}
	if game.Status == nil || *game.Status != "Terminado" {
		t.Errorf("status = %v, want the raw Terminado", game.Status)
	}
	if game.Score == nil || game.Score.Value != 9.2 {
		t.Errorf("score = %+v, want 9.2 read from a string with a comma", game.Score)
	}
	if game.Tagline == nil || *game.Tagline != "Lonely bug, big map" {
		t.Errorf("tagline = %v, want the four words", game.Tagline)
	}
	if game.Platform == nil || *game.Platform != "Nintendo Switch" {
		t.Errorf("platform = %v, want Nintendo Switch", game.Platform)
	}
	if len(game.Genres) != 2 || game.Genres[0] != "Metroidvania" || game.Genres[1] != "Acción" {
		t.Errorf("genres = %v, want the comma-separated list split in two", game.Genres)
	}
	if want := time.Date(2017, time.February, 24, 0, 0, 0, 0, time.UTC); game.ReleaseDate == nil ||
		!game.ReleaseDate.Time.Equal(want) {
		t.Errorf("release_date = %+v, want %v read day first", game.ReleaseDate, want)
	}
	if game.CoverImageURL == nil {
		t.Error("cover_image_url was not read from Portada")
	}
}

// The canonical name of a field wins over an alias, whatever order the keys
// arrive in, so the same file always imports the same way.
func TestImportPrefersTheCanonicalFieldName(t *testing.T) {
	for range 20 {
		game := onlyGame(t, `{"games": [{"name": "Alias", "title": "Canonical"}]}`)
		if *game.Title != "Canonical" {
			t.Fatalf("title = %v, want Canonical", *game.Title)
		}
	}
}

func TestImportReadsDatesInSeveralFormats(t *testing.T) {
	want := time.Date(2017, time.February, 24, 0, 0, 0, 0, time.UTC)

	for _, written := range []string{
		`"2017-02-24"`,
		`"24/02/2017"`,
		`"24-02-2017"`,
		`"2017-02-24T18:30:00Z"`,
		`"February 24, 2017"`,
		`"24 February 2017"`,
	} {
		var date service.Date
		if err := json.Unmarshal([]byte(written), &date); err != nil {
			t.Errorf("%s: %v", written, err)
			continue
		}
		if !date.Time.Equal(want) {
			t.Errorf("%s decoded to %v, want %v", written, date.Time, want)
		}
	}

	var unreadable service.Date
	if err := json.Unmarshal([]byte(`"one fine day"`), &unreadable); err == nil {
		t.Error("a date that means nothing was accepted")
	}
}

// An export writes what an import reads: the two halves of the format have to
// agree on how a date is spelled.
func TestDateIsWrittenAsACalendarDate(t *testing.T) {
	date := service.NewDate(time.Date(2017, time.February, 24, 18, 30, 0, 0, time.UTC))

	encoded, err := json.Marshal(date)
	if err != nil {
		t.Fatalf("encoding a date: %v", err)
	}
	if string(encoded) != `"2017-02-24"` {
		t.Errorf("encoded = %s, want the calendar date alone", encoded)
	}

	var blank service.Date
	if encoded, _ := json.Marshal(blank); string(encoded) != "null" {
		t.Errorf("a date that is not there encoded to %s, want null", encoded)
	}
}

func TestImportReadsListsOfNamesInEveryShape(t *testing.T) {
	for _, written := range []string{
		`["Action", "RPG"]`,
		`"Action, RPG"`,
		`[{"name": "Action"}, {"name": "RPG"}]`,
	} {
		game := onlyGame(t, `{"games": [{"title": "X", "genres": `+written+`}]}`)
		if len(game.Genres) != 2 || game.Genres[0] != "Action" || game.Genres[1] != "RPG" {
			t.Errorf("%s decoded to %v, want [Action RPG]", written, game.Genres)
		}
	}
}

// The three states a field can be in are what makes a merge a merge: only what
// the document carries is written.
func TestImportTellsAbsentFromEmpty(t *testing.T) {
	absent := onlyGame(t, `{"games": [{"title": "X"}]}`)
	if absent.Tagline != nil || absent.Genres != nil || absent.Score != nil || absent.ReleaseDate != nil {
		t.Errorf("a game carrying only a title decoded to %+v, want every other field absent", absent)
	}

	null := onlyGame(t, `{"games": [{"title": "X", "tagline": null, "genres": null}]}`)
	if null.Tagline != nil || null.Genres != nil {
		t.Error("null was read as a value rather than as an absent field")
	}

	empty := onlyGame(t, `{"games": [{"title": "X", "tagline": "", "genres": [], "score": "", "logged_date": ""}]}`)
	if empty.Tagline == nil || *empty.Tagline != "" {
		t.Errorf("tagline = %v, want an empty string that clears it", empty.Tagline)
	}
	if empty.Genres == nil || len(empty.Genres) != 0 {
		t.Errorf("genres = %v, want an empty list that clears the relation", empty.Genres)
	}
	if empty.Score == nil || !empty.Score.Blank {
		t.Errorf("score = %+v, want a blank that clears it", empty.Score)
	}
	if empty.LoggedDate == nil || !empty.LoggedDate.Blank {
		t.Errorf("logged_date = %+v, want a blank that clears it", empty.LoggedDate)
	}
}

func TestImportReadsLookupsAsNamesOrObjects(t *testing.T) {
	document := decodeDocument(t, `{"genres": ["Metroidvania", {"name": "RPG", "icono": "🐉"}]}`)

	if len(document.Genres) != 2 {
		t.Fatalf("decoded %d genres, want 2", len(document.Genres))
	}
	if document.Genres[0].Name == nil || *document.Genres[0].Name != "Metroidvania" {
		t.Errorf("first genre = %+v, want the bare name read as a name", document.Genres[0])
	}
	if document.Genres[1].Icon == nil || *document.Genres[1].Icon != "🐉" {
		t.Errorf("second genre = %+v, want the icon read from its alias", document.Genres[1])
	}
}

func TestImportReadsSectionsUnderTheirAliases(t *testing.T) {
	document := decodeDocument(t, `{"juegos": [{"title": "X"}], "generos": ["RPG"], "desarrolladores": ["Team Cherry"]}`)

	if len(document.Games) != 1 || len(document.Genres) != 1 || len(document.Developers) != 1 {
		t.Errorf("document = %+v, want the three sections read under their Spanish names", document)
	}
}

func TestImportRejectsWhatItCannotRead(t *testing.T) {
	for _, body := range []string{
		`{"games": [{"title": "X", "score": "nine"}]}`,
		`{"games": [{"title": "X", "release_date": 2017}]}`,
		`{"games": [{"title": "X", "genres": [17]}]}`,
		`{"games": ["Hollow Knight"]}`,
	} {
		var document service.ImportDocument
		if err := json.Unmarshal([]byte(body), &document); err == nil {
			t.Errorf("%s was accepted, want a decoding error the caller can act on", body)
		}
	}
}

func TestImportReadsIGDBCompanyIDsInEveryShape(t *testing.T) {
	tests := []struct {
		value       string
		wantValues  []uint64
		wantDropped int
	}{
		{`[37, 1234]`, []uint64{37, 1234}, 0},
		{`37`, []uint64{37}, 0},
		{`37.0`, []uint64{37}, 0},
		{`"37"`, []uint64{37}, 0},
		{`"37, 1234; 70 9"`, []uint64{37, 1234, 70, 9}, 0},
		{`["37", 1234, null]`, []uint64{37, 1234}, 0},
		{`null`, nil, 0},
		{`"none"`, nil, 1},
		{`[37, "x", -1, 2.5, true]`, []uint64{37}, 4},
		{`{"id": 37}`, nil, 1},
	}
	for _, test := range tests {
		// Under a spelling another tool would use, to go through the same
		// aliasing as a real file.
		document := decodeDocument(t, `{"developers": [{"name": "Capcom", "IGDB IDs": `+test.value+`}]}`)
		ids := document.Developers[0].IGDBCompanyIDs
		if ids == nil {
			// null leaves the pointer unset, which is the same as no ids.
			ids = &service.IDList{}
		}
		if fmt.Sprint(ids.Values) != fmt.Sprint(test.wantValues) || ids.Dropped != test.wantDropped {
			t.Errorf("%s: read %v with %d dropped, want %v with %d dropped",
				test.value, ids.Values, ids.Dropped, test.wantValues, test.wantDropped)
		}
	}
}

// A game's IGDB id is read with the same leniency as a developer's, under
// the names a spreadsheet would give the column.
func TestImportReadsAGamesIGDBID(t *testing.T) {
	for _, field := range []string{`"igdb_id": 26192`, `"IGDB ID": "26192"`, `"IGDB": 26192`} {
		document := decodeDocument(t, `{"games": [{"title": "Resident Evil 4", `+field+`}]}`)
		ids := document.Games[0].IGDBID
		if ids == nil || fmt.Sprint(ids.Values) != "[26192]" || ids.Dropped != 0 {
			t.Errorf("%s: read %+v, want the id 26192", field, ids)
		}
	}
}

// TestImportRefusesNumbersNoColumnCanHold: strconv reads "NaN" and "Inf" as
// numbers, which would reach the database and fail the whole import there.
func TestImportRefusesNumbersNoColumnCanHold(t *testing.T) {
	for _, value := range []string{"NaN", "Inf", "-infinity"} {
		var number service.Number
		if err := json.Unmarshal([]byte(`"`+value+`"`), &number); err == nil {
			t.Errorf("%q was read as %v, want it refused", value, number.Value)
		}
	}
}
