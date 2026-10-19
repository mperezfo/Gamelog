package handlers_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/handlers"
	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// fakeSearcher stands in for IGDB, answering every search the same way.
type fakeSearcher struct {
	games []igdb.Game
	err   error
}

func (f *fakeSearcher) Search(context.Context, string) ([]igdb.Game, error) {
	return f.games, f.err
}

// Companies knows Capcom (37) and Nintendo (70), and nothing else.
func (f *fakeSearcher) Companies(_ context.Context, ids []uint64) ([]igdb.Company, error) {
	if f.err != nil {
		return nil, f.err
	}
	known := map[uint64]string{37: "Capcom", 70: "Nintendo"}
	companies := []igdb.Company{}
	for _, id := range ids {
		if name, ok := known[id]; ok {
			companies = append(companies, igdb.Company{ID: id, Name: name})
		}
	}
	return companies, nil
}

// CompanyURL knows Capcom (37) and nothing else.
func (f *fakeSearcher) CompanyURL(_ context.Context, id uint64) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	if id == 37 {
		return "https://www.igdb.com/companies/capcom", nil
	}
	return "", igdb.ErrNotFound
}

// Platforms knows PC (6) and nothing else.
func (f *fakeSearcher) Platforms(_ context.Context, ids []uint64) ([]igdb.Platform, error) {
	if f.err != nil {
		return nil, f.err
	}
	platforms := []igdb.Platform{}
	for _, id := range ids {
		if id == 6 {
			platforms = append(platforms, igdb.Platform{ID: 6, Name: "PC (Microsoft Windows)", Abbreviation: "PC"})
		}
	}
	return platforms, nil
}

// PlatformURL knows PC (6) and nothing else.
func (f *fakeSearcher) PlatformURL(_ context.Context, id uint64) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	if id == 6 {
		return "https://www.igdb.com/platforms/win", nil
	}
	return "", igdb.ErrNotFound
}

// GameURL knows Resident Evil 4 (26192) and nothing else.
func (f *fakeSearcher) GameURL(_ context.Context, id uint64) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	if id == 26192 {
		return "https://www.igdb.com/games/resident-evil-4--1", nil
	}
	return "", igdb.ErrNotFound
}

// newMetadataRouter builds the API around games, which router.New would
// otherwise build from real IGDB credentials. A nil games is a deployment
// without them.
func newMetadataRouter(db *gorm.DB, source handlers.IGDB) http.Handler {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Gamelog API", "test"))
	handlers.Register(api, db, newAuthService(db), os.TempDir(), "test", source)
	return r
}

// sameSession wraps handler in the session another wrapped handler carries,
// so that one account can be served by two differently built routers.
func sameSession(handler, signedInHandler http.Handler) http.Handler {
	return sessionHandler{handler: handler, cookie: signedInHandler.(sessionHandler).cookie}
}

type candidateResponse struct {
	Candidates []struct {
		IGDBID      uint64     `json:"igdb_id"`
		Name        string     `json:"name"`
		ReleaseDate *time.Time `json:"release_date"`
		Platforms   []platformMatchResponse
		Developers  []companyMatchResponse
		Publishers  []companyMatchResponse
	} `json:"candidates"`
}

type platformMatchResponse struct {
	IGDBPlatformID uint64 `json:"igdb_platform_id"`
	Name           string `json:"name"`
	Abbreviation   string `json:"abbreviation"`
	Match          *struct {
		ID     uint64 `json:"id"`
		Name   string `json:"name"`
		Reason string `json:"reason"`
	} `json:"match"`
}

type companyMatchResponse struct {
	IGDBCompanyID uint64 `json:"igdb_company_id"`
	Name          string `json:"name"`
	Match         *struct {
		ID     uint64 `json:"id"`
		Name   string `json:"name"`
		Reason string `json:"reason"`
	} `json:"match"`
}

// searchMetadata looks a title up and returns the first candidate's
// developers and publishers.
func searchMetadata(t *testing.T, handler http.Handler) candidateResponse {
	t.Helper()

	rec := request(t, handler, http.MethodGet, "/api/metadata/games?title=Resident%20Evil%204", nil)
	expectStatus(t, rec, http.StatusOK, "searching IGDB")

	var response candidateResponse
	decode(t, rec, &response)
	if len(response.Candidates) == 0 {
		t.Fatal("the search returned no candidates")
	}
	return response
}

// expectMatch checks which record a company was matched to, and how. A zero
// wantID means no match at all.
func expectMatch(t *testing.T, company companyMatchResponse, wantID uint64, wantReason string) {
	t.Helper()

	if wantID == 0 {
		if company.Match != nil {
			t.Errorf("%s matched %q (%s), want no match", company.Name, company.Match.Name, company.Match.Reason)
		}
		return
	}
	if company.Match == nil {
		t.Errorf("%s matched nothing, want %d (%s)", company.Name, wantID, wantReason)
		return
	}
	if company.Match.ID != wantID || company.Match.Reason != wantReason {
		t.Errorf("%s matched %d %q (%s), want %d (%s)",
			company.Name, company.Match.ID, company.Match.Name, company.Match.Reason, wantID, wantReason)
	}
}

func TestMetadataWithoutIGDB(t *testing.T) {
	db := testsupport.NewDatabase(t)
	handler := signedIn(t, newMetadataRouter(db, nil), db, "player", false)

	rec := request(t, handler, http.MethodGet, "/api/metadata/capabilities", nil)
	expectStatus(t, rec, http.StatusOK, "reading the capabilities")
	var capabilities struct {
		Identify bool `json:"identify"`
	}
	decode(t, rec, &capabilities)
	if capabilities.Identify {
		t.Error("identify = true on a deployment without IGDB credentials")
	}

	expectStatus(t, request(t, handler, http.MethodGet, "/api/metadata/games?title=Celeste", nil),
		http.StatusNotImplemented, "searching without IGDB credentials")
	expectStatus(t, request(t, handler, http.MethodGet, "/api/metadata/companies/37/page", nil),
		http.StatusNotImplemented, "opening a company without IGDB credentials")
}

func TestMetadataSearchMatchesCompanies(t *testing.T) {
	db := testsupport.NewDatabase(t)

	released := time.Date(2023, 3, 24, 0, 0, 0, 0, time.UTC)
	searcher := &fakeSearcher{games: []igdb.Game{{
		ID:          26192,
		Name:        "Resident Evil 4",
		ReleaseDate: &released,
		Platforms:   []igdb.Platform{{ID: 167, Name: "PlayStation 5", Abbreviation: "PS5"}},
		Developers:  []igdb.Company{{ID: 37, Name: "Capcom"}, {ID: 900, Name: "Insomniac Games"}},
		Publishers:  []igdb.Company{{ID: 10100, Name: "Sony Interactive Entertainment"}},
	}}}
	handler := signedIn(t, newMetadataRouter(db, searcher), db, "player", false)

	rec := request(t, handler, http.MethodGet, "/api/metadata/capabilities", nil)
	expectStatus(t, rec, http.StatusOK, "reading the capabilities")
	var capabilities struct {
		Identify bool `json:"identify"`
	}
	decode(t, rec, &capabilities)
	if !capabilities.Identify {
		t.Error("identify = false on a deployment with IGDB credentials")
	}

	capcom := createLookup(t, handler, "/api/developers", "CAPCOM")
	sony := createLookup(t, handler, "/api/publishers", "Sony")

	// Guesses from the name alone.
	found := searchMetadata(t, handler).Candidates[0]
	if found.IGDBID != 26192 || found.ReleaseDate == nil || !found.ReleaseDate.Equal(released) {
		t.Errorf("candidate = %d released %v", found.IGDBID, found.ReleaseDate)
	}
	expectMatch(t, found.Developers[0], capcom, "name")
	expectMatch(t, found.Developers[1], 0, "")
	expectMatch(t, found.Publishers[0], sony, "normalized")

	// Saving a game with those choices links them, and the next search
	// recognises them outright.
	rec = request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":           "Resident Evil 4",
		"status":          models.StatusPlaying,
		"position":        1,
		"developer_ids":   []uint64{capcom},
		"developer_links": []map[string]any{{"id": capcom, "igdb_company_id": 37}},
		"new_developers":  []map[string]any{{"name": "Insomniac Games", "igdb_company_id": 900}},
		"publisher_ids":   []uint64{sony},
		"publisher_links": []map[string]any{{"id": sony, "igdb_company_id": 10100}},
	})
	expectStatus(t, rec, http.StatusCreated, "saving the identified game")
	var game models.Game
	decode(t, rec, &game)
	if len(game.Developers) != 2 || len(game.Publishers) != 1 {
		t.Fatalf("game has %d developers and %d publishers, want 2 and 1", len(game.Developers), len(game.Publishers))
	}
	var insomniac uint64
	for _, developer := range game.Developers {
		if developer.Name == "Insomniac Games" {
			insomniac = developer.ID
		}
	}
	if insomniac == 0 {
		t.Fatalf("developers = %+v, want Insomniac Games created", game.Developers)
	}

	found = searchMetadata(t, handler).Candidates[0]
	expectMatch(t, found.Developers[0], capcom, "linked")
	expectMatch(t, found.Developers[1], insomniac, "linked")
	expectMatch(t, found.Publishers[0], sony, "linked")

	// A company's page is a redirect to igdb.com.
	rec = request(t, handler, http.MethodGet, "/api/metadata/companies/37/page", nil)
	expectStatus(t, rec, http.StatusFound, "opening Capcom's page")
	if location := rec.Header().Get("Location"); location != "https://www.igdb.com/companies/capcom" {
		t.Errorf("Location = %q, want Capcom's page", location)
	}
	expectStatus(t, request(t, handler, http.MethodGet, "/api/metadata/companies/1/page", nil),
		http.StatusNotFound, "opening a company IGDB does not have")

	// So is a game's.
	rec = request(t, handler, http.MethodGet, "/api/metadata/games/26192/page", nil)
	expectStatus(t, rec, http.StatusFound, "opening Resident Evil 4's page")
	if location := rec.Header().Get("Location"); location != "https://www.igdb.com/games/resident-evil-4--1" {
		t.Errorf("Location = %q, want Resident Evil 4's page", location)
	}
	expectStatus(t, request(t, handler, http.MethodGet, "/api/metadata/games/1/page", nil),
		http.StatusNotFound, "opening a game IGDB does not have")

	// Companies are named in the order asked for, and unknown ones left out.
	rec = request(t, handler, http.MethodGet, "/api/metadata/companies?ids=70,1,37", nil)
	expectStatus(t, rec, http.StatusOK, "naming companies")
	var named struct {
		Companies []struct {
			ID   uint64 `json:"id"`
			Name string `json:"name"`
		} `json:"companies"`
	}
	decode(t, rec, &named)
	if len(named.Companies) != 2 || named.Companies[0].Name != "Nintendo" || named.Companies[1].Name != "Capcom" {
		t.Errorf("companies = %+v, want Nintendo then Capcom", named.Companies)
	}

	// IGDB failing is a 424: not a 500, since nothing is wrong here, and not
	// a 502, which the frontend would take for the whole server being down.
	searcher.err = errors.New("connection refused")
	expectStatus(t, request(t, handler, http.MethodGet, "/api/metadata/games?title=Celeste", nil),
		http.StatusFailedDependency, "searching while IGDB is down")
}

func TestGameWriteCreatesAndLinksCompanies(t *testing.T) {
	db := testsupport.NewDatabase(t)
	searcher := &fakeSearcher{games: []igdb.Game{{
		ID:         1,
		Name:       "Resident Evil 4",
		Developers: []igdb.Company{{ID: 1, Name: "Team Cherry"}},
		Publishers: []igdb.Company{{ID: 10100, Name: "Sony Interactive Entertainment"}},
	}}}
	bare := newMetadataRouter(db, searcher)
	alice := signedIn(t, bare, db, "alice", false)
	bob := signedIn(t, bare, db, "bob", false)

	listNames := func(handler http.Handler, collection string) []string {
		t.Helper()
		rec := request(t, handler, http.MethodGet, collection, nil)
		expectStatus(t, rec, http.StatusOK, "listing "+collection)
		var records []struct {
			Name string `json:"name"`
		}
		decode(t, rec, &records)
		names := make([]string, 0, len(records))
		for _, record := range records {
			names = append(names, record.Name)
		}
		return names
	}

	// A new developer is created with the game, and a second game naming it
	// again, spelled differently, attaches the same record.
	for i, name := range []string{"Team Cherry", "team cherry"} {
		rec := request(t, alice, http.MethodPost, "/api/games", map[string]any{
			"title":          []string{"Hollow Knight", "Silksong"}[i],
			"status":         models.StatusPlayed,
			"position":       1,
			"new_developers": []map[string]any{{"name": name, "igdb_company_id": 1}},
		})
		expectStatus(t, rec, http.StatusCreated, "creating a game with a new developer spelled "+name)
	}
	if names := listNames(alice, "/api/developers"); len(names) != 1 || names[0] != "Team Cherry" {
		t.Errorf("developers = %v, want just Team Cherry", names)
	}

	// A write that fails leaves nothing behind: the developer it would have
	// created goes with it.
	rec := request(t, alice, http.MethodPost, "/api/games", map[string]any{
		"title":          "Ghost Game",
		"status":         models.StatusPending,
		"position":       1,
		"genre_ids":      []uint64{999999},
		"new_developers": []map[string]any{{"name": "Ghost Studio", "igdb_company_id": 5}},
	})
	expectStatus(t, rec, http.StatusUnprocessableEntity, "creating a game with a missing genre")
	if names := listNames(alice, "/api/developers"); len(names) != 1 {
		t.Errorf("developers = %v after a failed write, want it to have created nothing", names)
	}

	// Linking an IGDB company to a second record moves the link.
	sony := createLookup(t, alice, "/api/publishers", "Sony")
	sie := createLookup(t, alice, "/api/publishers", "SIE")
	for _, publisher := range []uint64{sony, sie} {
		rec := request(t, alice, http.MethodPut, "/api/games/hollow-knight", map[string]any{
			"title":           "Hollow Knight",
			"status":          models.StatusPlayed,
			"position":        1,
			"publisher_ids":   []uint64{publisher},
			"publisher_links": []map[string]any{{"id": publisher, "igdb_company_id": 10100}},
		})
		expectStatus(t, rec, http.StatusOK, "linking IGDB company 10100")
	}
	found := searchMetadata(t, alice).Candidates[0]
	expectMatch(t, found.Publishers[0], sie, "linked")

	// A listing carries the links too, for the lookup pages to show.
	rec = request(t, alice, http.MethodGet, "/api/publishers", nil)
	expectStatus(t, rec, http.StatusOK, "listing publishers")
	var listed []models.Publisher
	decode(t, rec, &listed)
	for _, publisher := range listed {
		want := map[uint64][]uint64{sie: {10100}}[publisher.ID]
		if len(publisher.IGDBCompanyIDs) != len(want) || (len(want) > 0 && publisher.IGDBCompanyIDs[0] != want[0]) {
			t.Errorf("%s lists igdb_company_ids %v, want %v", publisher.Name, publisher.IGDBCompanyIDs, want)
		}
	}
	rec = request(t, alice, http.MethodGet, itemPath("/api/publishers", sie), nil)
	expectStatus(t, rec, http.StatusOK, "reading a publisher")
	var read models.Publisher
	decode(t, rec, &read)
	if len(read.IGDBCompanyIDs) != 1 || read.IGDBCompanyIDs[0] != 10100 {
		t.Errorf("SIE reads with igdb_company_ids %v, want [10100]", read.IGDBCompanyIDs)
	}

	// An edit answers with the whole record, links included, as a read does.
	rec = request(t, alice, http.MethodPut, itemPath("/api/publishers", sie), map[string]any{"name": "SIE", "icon": "🎮"})
	expectStatus(t, rec, http.StatusOK, "editing a linked publisher")
	var edited models.Publisher
	decode(t, rec, &edited)
	if len(edited.IGDBCompanyIDs) != 1 || edited.IGDBCompanyIDs[0] != 10100 {
		t.Errorf("an edit answered with igdb_company_ids %v, want [10100]", edited.IGDBCompanyIDs)
	}

	// Another account's record cannot be linked.
	rec = request(t, bob, http.MethodPost, "/api/games", map[string]any{
		"title":           "Hollow Knight",
		"status":          models.StatusPlayed,
		"position":        1,
		"publisher_links": []map[string]any{{"id": sony, "igdb_company_id": 777}},
	})
	expectStatus(t, rec, http.StatusUnprocessableEntity, "bob linking alice's publisher")

	// The links travel with an export, and come back with an import.
	document := exportLibrary(t, alice)
	links := map[string][]uint64{}
	for _, entry := range append(document.Developers, document.Publishers...) {
		links[entry.Name] = entry.IGDBCompanyIDs
	}
	if got := links["Team Cherry"]; len(got) != 1 || got[0] != 1 {
		t.Errorf("Team Cherry exported with igdb_company_ids %v, want [1]", got)
	}
	if got := links["SIE"]; len(got) != 1 || got[0] != 10100 {
		t.Errorf("SIE exported with igdb_company_ids %v, want [10100]", got)
	}
	if got := links["Sony"]; len(got) != 0 {
		t.Errorf("Sony exported with igdb_company_ids %v, want none", got)
	}

	importLibrary(t, bob, "/api/import", document)
	found = searchMetadata(t, bob).Candidates[0]
	if found.Developers[0].Match == nil || found.Developers[0].Match.Reason != "linked" ||
		found.Publishers[0].Match == nil || found.Publishers[0].Match.Name != "SIE" ||
		found.Publishers[0].Match.Reason != "linked" {
		t.Errorf("after importing alice's library, bob's matches = %+v and %+v, want both linked",
			found.Developers[0].Match, found.Publishers[0].Match)
	}

	// Only developers and publishers can be linked.
	report := importLibrary(t, bob, "/api/import", map[string]any{
		"genres": []map[string]any{{"name": "Metroidvania", "igdb_company_ids": []uint64{1}}},
	})
	if len(report.Warnings) != 1 || report.Warnings[0].Section != "genres" {
		t.Errorf("warnings = %+v, want one about the genre's igdb_company_ids", report.Warnings)
	}

	// An odd value from another tool is reported, not a reason to refuse the
	// whole file: the request passes validation and the rest still imports.
	report = importLibrary(t, bob, "/api/import", map[string]any{
		"developers": []map[string]any{{"name": "Grasshopper", "IGDB IDs": "77, not an id"}},
		"games":      []map[string]any{{"title": "Killer7"}},
	})
	if report.Created.Games != 1 || len(report.Warnings) != 1 || report.Warnings[0].Section != "developers" {
		t.Errorf("report = %+v, want the game imported and one warning about the dropped id", report)
	}
}

// expectPlatformMatch is expectMatch for a platform.
func expectPlatformMatch(t *testing.T, platform platformMatchResponse, wantID uint64, wantReason string) {
	t.Helper()

	if wantID == 0 {
		if platform.Match != nil {
			t.Errorf("%s matched %q (%s), want no match", platform.Name, platform.Match.Name, platform.Match.Reason)
		}
		return
	}
	if platform.Match == nil {
		t.Errorf("%s matched nothing, want %d (%s)", platform.Name, wantID, wantReason)
		return
	}
	if platform.Match.ID != wantID || platform.Match.Reason != wantReason {
		t.Errorf("%s matched %d %q (%s), want %d (%s)",
			platform.Name, platform.Match.ID, platform.Match.Name, platform.Match.Reason, wantID, wantReason)
	}
}

func TestMetadataSearchMatchesPlatforms(t *testing.T) {
	db := testsupport.NewDatabase(t)

	searcher := &fakeSearcher{games: []igdb.Game{{
		ID:   26192,
		Name: "Resident Evil 4",
		Platforms: []igdb.Platform{
			{ID: 6, Name: "PC (Microsoft Windows)", Abbreviation: "PC"},
			{ID: 167, Name: "PlayStation 5", Abbreviation: "PS5"},
			{ID: 11, Name: "Xbox", Abbreviation: "XBOX"},
			{ID: 48, Name: "PlayStation 4", Abbreviation: "PS4"},
		},
	}}}
	handler := signedIn(t, newMetadataRouter(db, searcher), db, "player", false)

	pc := createLookup(t, handler, "/api/platforms", "PC")
	deck := createLookup(t, handler, "/api/platforms", "STEAM DECK")
	ps5 := createLookup(t, handler, "/api/platforms", "PlayStation 5")
	createLookup(t, handler, "/api/platforms", "XBOX SERIES X")

	// Guesses: the abbreviation first, then the name, never a prefix.
	platforms := searchMetadata(t, handler).Candidates[0].Platforms
	if len(platforms) != 4 || platforms[0].Abbreviation != "PC" {
		t.Fatalf("platforms = %+v, want IGDB's four with their abbreviations", platforms)
	}
	expectPlatformMatch(t, platforms[0], pc, "name")
	expectPlatformMatch(t, platforms[1], ps5, "name")
	expectPlatformMatch(t, platforms[2], 0, "")
	expectPlatformMatch(t, platforms[3], 0, "")

	// One game on the Steam Deck and two on PC, all three linking IGDB's
	// PC: an IGDB platform keeps every platform it is linked to.
	save := func(title string, body map[string]any) models.Game {
		t.Helper()
		body["title"] = title
		body["status"] = models.StatusPlayed
		body["position"] = 1
		rec := request(t, handler, http.MethodPost, "/api/games", body)
		expectStatus(t, rec, http.StatusCreated, "creating "+title)
		var game models.Game
		decode(t, rec, &game)
		return game
	}
	save("Hades", map[string]any{"platform_id": deck, "platform_link": map[string]any{"id": deck, "igdb_platform_id": 6}})
	save("Celeste", map[string]any{"platform_id": pc, "platform_link": map[string]any{"id": pc, "igdb_platform_id": 6}})
	save("Tunic", map[string]any{"platform_id": pc, "platform_link": map[string]any{"id": pc, "igdb_platform_id": 6}})

	// A platform the library does not have is created by name and linked.
	game := save("Bloodborne", map[string]any{"new_platform": map[string]any{"name": "PS4", "igdb_platform_id": 48}})
	if game.Platform == nil || game.Platform.Name != "PS4" {
		t.Fatalf("platform = %+v, want PS4 created", game.Platform)
	}

	// Of the two linked to IGDB's PC, the one with more games is suggested.
	platforms = searchMetadata(t, handler).Candidates[0].Platforms
	expectPlatformMatch(t, platforms[0], pc, "linked")
	expectPlatformMatch(t, platforms[3], game.Platform.ID, "linked")

	rec := request(t, handler, http.MethodGet, fmt.Sprintf("/api/platforms/%d", deck), nil)
	expectStatus(t, rec, http.StatusOK, "reading the Steam Deck")
	var read models.Platform
	decode(t, rec, &read)
	if fmt.Sprint(read.IGDBPlatformIDs) != "[6]" {
		t.Errorf("igdb_platform_ids = %v, want [6]", read.IGDBPlatformIDs)
	}

	// IGDB platforms are named by id, and their pages redirected to.
	rec = request(t, handler, http.MethodGet, "/api/metadata/platforms?ids=1,6", nil)
	expectStatus(t, rec, http.StatusOK, "naming platforms")
	var named struct {
		Platforms []struct {
			ID           uint64 `json:"id"`
			Abbreviation string `json:"abbreviation"`
		} `json:"platforms"`
	}
	decode(t, rec, &named)
	if len(named.Platforms) != 1 || named.Platforms[0].Abbreviation != "PC" {
		t.Errorf("platforms = %+v, want PC alone", named.Platforms)
	}
	rec = request(t, handler, http.MethodGet, "/api/metadata/platforms/6/page", nil)
	expectStatus(t, rec, http.StatusFound, "opening PC's page")
	if location := rec.Header().Get("Location"); location != "https://www.igdb.com/platforms/win" {
		t.Errorf("Location = %q, want PC's page", location)
	}
}
