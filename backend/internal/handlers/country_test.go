package handlers_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// readDeveloper reads one developer back through the API.
func readDeveloper(t *testing.T, handler http.Handler, id uint64) models.Developer {
	t.Helper()
	rec := request(t, handler, http.MethodGet, itemPath("/api/developers", id), nil)
	expectStatus(t, rec, http.StatusOK, "reading a developer")
	var developer models.Developer
	decode(t, rec, &developer)
	return developer
}

func countryOf(developer models.Developer) string {
	if developer.Country == nil {
		return ""
	}
	return *developer.Country
}

// TestCompanyCountryIsSetByHand: a developer or publisher carries a country
// in place of an icon, and only a real one.
func TestCompanyCountryIsSetByHand(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	rec := request(t, handler, http.MethodPost, "/api/developers", map[string]any{"name": "FromSoftware", "country": "JP"})
	expectStatus(t, rec, http.StatusCreated, "creating a developer with a country")
	var developer models.Developer
	decode(t, rec, &developer)
	if countryOf(developer) != "JP" {
		t.Errorf("country = %q, want JP", countryOf(developer))
	}

	for _, code := range []string{"XX", "jp", "JPN"} {
		rec := request(t, handler, http.MethodPost, "/api/publishers", map[string]any{"name": "Nobody " + code, "country": code})
		expectStatus(t, rec, http.StatusUnprocessableEntity, "creating a publisher with the country "+code)
	}

	// Like an icon, a country left out of a replacement is cleared.
	rec = request(t, handler, http.MethodPut, itemPath("/api/developers", developer.ID), map[string]any{"name": "FromSoftware"})
	expectStatus(t, rec, http.StatusOK, "replacing a developer without a country")
	if got := readDeveloper(t, handler, developer.ID); got.Country != nil {
		t.Errorf("country = %q after a replacement without one, want it cleared", *got.Country)
	}

	// A genre has no country, and still has its icon.
	rec = request(t, handler, http.MethodPost, "/api/genres", map[string]any{"name": "RPG", "icon": "🐉", "country": "JP"})
	expectStatus(t, rec, http.StatusCreated, "creating a genre with a country")
	if body := rec.Body.String(); strings.Contains(body, "country") || !strings.Contains(body, "🐉") {
		t.Errorf("genre = %s, want its icon and no country", body)
	}
}

// TestIdentifyFillsInACompanyCountry: the country IGDB gives a company is
// stored along with the link to it, on a record that has none.
func TestIdentifyFillsInACompanyCountry(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	cherry := createLookup(t, handler, "/api/developers", "Team Cherry")
	rec := request(t, handler, http.MethodPost, "/api/developers", map[string]any{"name": "Capcom", "country": "JP"})
	expectStatus(t, rec, http.StatusCreated, "creating Capcom")
	var capcom models.Developer
	decode(t, rec, &capcom)

	rec = request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":         "Hollow Knight",
		"status":        models.StatusPlayed,
		"position":      1,
		"developer_ids": []uint64{cherry, capcom.ID},
		"developer_links": []map[string]any{
			{"id": cherry, "igdb_company_id": 1, "country": "AU"},
			// A second company of the same record says otherwise: the first
			// one wins.
			{"id": cherry, "igdb_company_id": 2, "country": "NZ"},
			// One set by hand is never overwritten.
			{"id": capcom.ID, "igdb_company_id": 37, "country": "US"},
		},
		"new_developers": []map[string]any{{"name": "Ari Gibson", "igdb_company_id": 3, "country": "AU"}},
	})
	expectStatus(t, rec, http.StatusCreated, "creating a game that links its developers")

	if got := countryOf(readDeveloper(t, handler, cherry)); got != "AU" {
		t.Errorf("Team Cherry's country = %q, want AU from its first link", got)
	}
	if got := countryOf(readDeveloper(t, handler, capcom.ID)); got != "JP" {
		t.Errorf("Capcom's country = %q, want the JP set by hand", got)
	}

	rec = request(t, handler, http.MethodGet, "/api/developers", nil)
	expectStatus(t, rec, http.StatusOK, "listing developers")
	var developers []models.Developer
	decode(t, rec, &developers)
	for _, developer := range developers {
		if developer.Name == "Ari Gibson" && countryOf(developer) != "AU" {
			t.Errorf("the new developer's country = %q, want AU", countryOf(developer))
		}
	}

	rec = request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":           "Silksong",
		"status":          models.StatusPending,
		"position":        1,
		"developer_links": []map[string]any{{"id": cherry, "igdb_company_id": 1, "country": "XX"}},
	})
	expectStatus(t, rec, http.StatusUnprocessableEntity, "linking with a country that is none")
}

// TestCompanyCountryTravelsWithAnExport: the country goes out with an export
// and comes back with an import, read loosely like the rest of a document.
func TestCompanyCountryTravelsWithAnExport(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	rec := request(t, handler, http.MethodPost, "/api/publishers", map[string]any{"name": "Devolver Digital", "country": "US"})
	expectStatus(t, rec, http.StatusCreated, "creating a publisher")

	document := exportLibrary(t, handler)
	if len(document.Publishers) != 1 || document.Publishers[0].Country == nil || *document.Publishers[0].Country != "US" {
		t.Fatalf("exported publishers = %+v, want Devolver Digital from the US", document.Publishers)
	}

	report := importLibrary(t, handler, "/api/import", map[string]any{
		"developers": []map[string]any{
			{"name": "Mercury Steam", "país": " es "},
			{"name": "Nowhere Games", "country": "Narnia"},
			// An icon from an export made before countries is dropped.
			{"name": "Old Studio", "icon": "🎮"},
		},
	})
	if len(report.Warnings) != 1 {
		t.Errorf("warnings = %+v, want the one about Narnia", report.Warnings)
	}

	exported := exportLibrary(t, handler)
	countries := map[string]string{}
	for _, entry := range exported.Developers {
		if entry.Country != nil {
			countries[entry.Name] = *entry.Country
		}
		if entry.Icon != nil {
			t.Errorf("%s exported with the icon %q, want none", entry.Name, *entry.Icon)
		}
	}
	if countries["Mercury Steam"] != "ES" || countries["Nowhere Games"] != "" {
		t.Errorf("imported countries = %v, want ES for Mercury Steam and none for Nowhere Games", countries)
	}
}
