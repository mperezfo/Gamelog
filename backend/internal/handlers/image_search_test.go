package handlers_test

import (
	"context"
	"errors"
	"net/http"
	"os"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/handlers"
	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/steamgriddb"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// fakeSteamGridDB stands in for SteamGridDB, which knows Celeste (5) and
// Celeste Classic (6), and has images for Celeste only.
type fakeSteamGridDB struct {
	err error
}

func (f *fakeSteamGridDB) Search(context.Context, string) ([]steamgriddb.Game, error) {
	if f.err != nil {
		return nil, f.err
	}
	return []steamgriddb.Game{{ID: 5, Name: "Celeste"}, {ID: 6, Name: "Celeste Classic"}}, nil
}

func (f *fakeSteamGridDB) Images(_ context.Context, id uint64) ([]steamgriddb.Image, error) {
	if f.err != nil {
		return nil, f.err
	}
	if id != 5 {
		return []steamgriddb.Image{}, nil
	}
	return []steamgriddb.Image{
		{URL: "https://cdn2.steamgriddb.com/grid/a.png", ThumbURL: "https://cdn2.steamgriddb.com/thumb/a.jpg", Width: 600, Height: 900, Kind: steamgriddb.KindGrid},
		{URL: "https://cdn2.steamgriddb.com/hero/b.png", ThumbURL: "https://cdn2.steamgriddb.com/thumb/b.jpg", Width: 1920, Height: 620, Kind: steamgriddb.KindHero},
	}, nil
}

// newSourcesRouter builds the API around the given outside services.
func newSourcesRouter(db *gorm.DB, sources handlers.Sources) http.Handler {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Gamelog API", "test"))
	handlers.Register(api, db, newAuthService(db), os.TempDir(), "test", sources)
	return r
}

type imageSearchResponse struct {
	Games []struct {
		ID   uint64 `json:"id"`
		Name string `json:"name"`
	} `json:"games"`
	GameID *uint64 `json:"game_id"`
	Images []struct {
		URL      string `json:"url"`
		ThumbURL string `json:"thumb_url"`
		Width    int    `json:"width"`
		Height   int    `json:"height"`
		Kind     string `json:"kind"`
	} `json:"images"`
}

func searchImages(t *testing.T, handler http.Handler, query string, want int) imageSearchResponse {
	t.Helper()
	rec := request(t, handler, http.MethodGet, "/api/metadata/images?"+query, nil)
	expectStatus(t, rec, want, "searching images with "+query)
	var response imageSearchResponse
	if want == http.StatusOK {
		decode(t, rec, &response)
	}
	return response
}

func imageSources(t *testing.T, handler http.Handler) []string {
	t.Helper()
	rec := request(t, handler, http.MethodGet, "/api/metadata/capabilities", nil)
	expectStatus(t, rec, http.StatusOK, "reading the capabilities")
	var capabilities struct {
		ImageSources []string `json:"image_sources"`
	}
	decode(t, rec, &capabilities)
	return capabilities.ImageSources
}

func TestImageSearch(t *testing.T) {
	db := testsupport.NewDatabase(t)
	searcher := &fakeSearcher{games: []igdb.Game{{ID: 26192, Name: "Resident Evil 4"}, {ID: 974, Name: "Resident Evil 4 (2005)"}}}
	handler := signedIn(t, newSourcesRouter(db, handlers.Sources{IGDB: searcher, SteamGridDB: &fakeSteamGridDB{}}), db, "player", false)

	if sources := imageSources(t, handler); len(sources) != 2 || sources[0] != "steamgriddb" || sources[1] != "igdb" {
		t.Errorf("image_sources = %v, want [steamgriddb igdb]", sources)
	}

	// By title: the matches, and the images of the first one.
	byTitle := searchImages(t, handler, "source=igdb&title=Resident+Evil+4", http.StatusOK)
	if len(byTitle.Games) != 2 || byTitle.GameID == nil || *byTitle.GameID != 26192 {
		t.Fatalf("search by title = %+v, want both games and the images of 26192", byTitle)
	}
	if len(byTitle.Images) != 1 || byTitle.Images[0].Kind != "cover" || byTitle.Images[0].Width != 1200 ||
		byTitle.Images[0].ThumbURL != "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co6bo0.jpg" {
		t.Errorf("images = %+v", byTitle.Images)
	}

	// By id alone: no matches to list, only the images.
	byID := searchImages(t, handler, "source=igdb&game_id=26192", http.StatusOK)
	if len(byID.Games) != 0 || byID.GameID == nil || *byID.GameID != 26192 || len(byID.Images) != 1 {
		t.Errorf("search by id = %+v", byID)
	}

	// SteamGridDB, with the id of a match other than the first.
	other := searchImages(t, handler, "source=steamgriddb&title=Celeste&game_id=6", http.StatusOK)
	if len(other.Games) != 2 || other.GameID == nil || *other.GameID != 6 || len(other.Images) != 0 {
		t.Errorf("search of the second match = %+v", other)
	}
	celeste := searchImages(t, handler, "source=steamgriddb&title=Celeste", http.StatusOK)
	if len(celeste.Images) != 2 || celeste.Images[0].Kind != "grid" || celeste.Images[1].Kind != "hero" {
		t.Errorf("SteamGridDB images = %+v", celeste.Images)
	}

	searchImages(t, handler, "source=igdb", http.StatusUnprocessableEntity)
	searchImages(t, handler, "source=igdb&title=+", http.StatusUnprocessableEntity)
	searchImages(t, handler, "source=elsewhere&title=Celeste", http.StatusUnprocessableEntity)
	searchImages(t, handler, "source=igdb&game_id=1", http.StatusNotFound)
}

func TestImageSearchWithNothingMatched(t *testing.T) {
	db := testsupport.NewDatabase(t)
	handler := signedIn(t, newSourcesRouter(db, handlers.Sources{IGDB: &fakeSearcher{}}), db, "player", false)

	response := searchImages(t, handler, "source=igdb&title=Nothing+Like+It", http.StatusOK)
	if response.GameID != nil || len(response.Games) != 0 || response.Images == nil || len(response.Images) != 0 {
		t.Errorf("search matching nothing = %+v, want no game and an empty list of images", response)
	}
}

func TestImageSearchFailures(t *testing.T) {
	db := testsupport.NewDatabase(t)

	none := signedIn(t, newSourcesRouter(db, handlers.Sources{}), db, "player", false)
	if sources := imageSources(t, none); sources == nil || len(sources) != 0 {
		t.Errorf("image_sources = %v, want an empty list", sources)
	}
	searchImages(t, none, "source=igdb&title=Celeste", http.StatusNotImplemented)
	searchImages(t, none, "source=steamgriddb&title=Celeste", http.StatusNotImplemented)

	down := errors.New("connection refused")
	failing := sameSession(newSourcesRouter(db, handlers.Sources{
		IGDB:        &fakeSearcher{err: down},
		SteamGridDB: &fakeSteamGridDB{err: down},
	}), none)
	searchImages(t, failing, "source=igdb&title=Celeste", http.StatusFailedDependency)
	searchImages(t, failing, "source=steamgriddb&game_id=5", http.StatusFailedDependency)
}
