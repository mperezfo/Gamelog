package igdb

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fakeIGDB stands in for both Twitch's token endpoint and the IGDB API.
type fakeIGDB struct {
	server *httptest.Server

	tokens atomic.Int32
	// rejectFirst answers the first API request with a 401, as IGDB does for
	// a token revoked before its time.
	rejectFirst atomic.Bool
	queries     []string
	authHeaders []string
	response    string
}

func newFakeIGDB(t *testing.T, response string) *fakeIGDB {
	t.Helper()

	fake := &fakeIGDB{response: response}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("token request: %v", err)
		}
		if r.Form.Get("client_id") != "id" || r.Form.Get("client_secret") != "secret" ||
			r.Form.Get("grant_type") != "client_credentials" {
			t.Errorf("token request form = %v", r.Form)
		}
		n := fake.tokens.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"access_token":"token-`+string(rune('0'+n))+`","expires_in":5000000,"token_type":"bearer"}`)
	})
	mux.HandleFunc("POST /v4/games", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		fake.queries = append(fake.queries, string(body))
		fake.authHeaders = append(fake.authHeaders, r.Header.Get("Authorization"))
		if r.Header.Get("Client-ID") != "id" {
			t.Errorf("Client-ID = %q, want %q", r.Header.Get("Client-ID"), "id")
		}
		if fake.rejectFirst.CompareAndSwap(true, false) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, fake.response)
	})

	fake.server = httptest.NewServer(mux)
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeIGDB) client() *Client {
	client := New("id", "secret")
	client.tokenURL = f.server.URL + "/token"
	client.apiURL = f.server.URL + "/v4"
	return client
}

func TestSearchMapsResults(t *testing.T) {
	fake := newFakeIGDB(t, `[{
		"id": 26192,
		"name": "Resident Evil 4",
		"first_release_date": 1679616000,
		"platforms": [{"id": 6, "name": "PC (Microsoft Windows)", "abbreviation": "PC"}, {"id": 167, "name": "PlayStation 5"}],
		"cover": {"id": 1, "image_id": "co6bo0"},
		"involved_companies": [
			{"company": {"id": 37, "name": "Capcom", "country": 392}, "developer": true, "publisher": true},
			{"company": {"id": 37, "name": "Capcom", "country": 392}, "developer": true, "publisher": false},
			{"company": {"id": 900, "name": "Some Port House"}, "developer": true, "publisher": false}
		]
	}, {
		"id": 1,
		"name": "Unknown"
	}]`)

	games, err := fake.client().Search(context.Background(), "Resident Evil 4")
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if len(games) != 2 {
		t.Fatalf("got %d games, want 2", len(games))
	}

	game := games[0]
	if game.ID != 26192 || game.Name != "Resident Evil 4" {
		t.Errorf("game = %d %q", game.ID, game.Name)
	}
	if want := time.Date(2023, 3, 24, 0, 0, 0, 0, time.UTC); game.ReleaseDate == nil || !game.ReleaseDate.Equal(want) {
		t.Errorf("ReleaseDate = %v, want %v", game.ReleaseDate, want)
	}
	if len(game.Platforms) != 2 || game.Platforms[0] != (Platform{6, "PC (Microsoft Windows)", "PC"}) ||
		game.Platforms[1] != (Platform{167, "PlayStation 5", ""}) {
		t.Errorf("Platforms = %v", game.Platforms)
	}
	if want := "https://images.igdb.com/igdb/image/upload/t_cover_small/co6bo0.jpg"; game.CoverURL == nil || *game.CoverURL != want {
		t.Errorf("CoverURL = %v, want %q", game.CoverURL, want)
	}
	if len(game.Developers) != 2 || game.Developers[0] != (Company{37, "Capcom", "JP"}) || game.Developers[1] != (Company{900, "Some Port House", ""}) {
		t.Errorf("Developers = %v", game.Developers)
	}
	if len(game.Publishers) != 1 || game.Publishers[0] != (Company{37, "Capcom", "JP"}) {
		t.Errorf("Publishers = %v", game.Publishers)
	}

	bare := games[1]
	if bare.ReleaseDate != nil || bare.CoverURL != nil || len(bare.Developers) != 0 || len(bare.Publishers) != 0 {
		t.Errorf("a game with nothing but a name = %+v", bare)
	}
}

func TestSearchEscapesTheTitle(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)

	if _, err := fake.client().Search(context.Background(), `Say "hi" \o/`); err != nil {
		t.Fatalf("Search: %v", err)
	}
	if want := `search "Say \"hi\" \\o/";`; !strings.HasPrefix(fake.queries[0], want) {
		t.Errorf("query = %q, want it to start with %q", fake.queries[0], want)
	}
}

func TestTokenIsReused(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)
	client := fake.client()

	for range 3 {
		if _, err := client.Search(context.Background(), "Celeste"); err != nil {
			t.Fatalf("Search: %v", err)
		}
	}
	if got := fake.tokens.Load(); got != 1 {
		t.Errorf("fetched %d tokens, want 1", got)
	}
	for _, header := range fake.authHeaders {
		if header != "Bearer token-1" {
			t.Errorf("Authorization = %q, want %q", header, "Bearer token-1")
		}
	}
}

func TestTokenIsRenewedWhenItRunsOut(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)
	client := fake.client()
	now := time.Now()
	client.now = func() time.Time { return now }

	if _, err := client.Search(context.Background(), "Celeste"); err != nil {
		t.Fatalf("Search: %v", err)
	}
	// Within the margin of its expiry.
	now = now.Add(5000000*time.Second - tokenMargin/2)
	if _, err := client.Search(context.Background(), "Celeste"); err != nil {
		t.Fatalf("Search: %v", err)
	}
	if got := fake.tokens.Load(); got != 2 {
		t.Errorf("fetched %d tokens, want 2", got)
	}
}

func TestTokenIsRenewedAfterAnUnauthorizedResponse(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)
	fake.rejectFirst.Store(true)

	if _, err := fake.client().Search(context.Background(), "Celeste"); err != nil {
		t.Fatalf("Search: %v", err)
	}
	if got := fake.tokens.Load(); got != 2 {
		t.Errorf("fetched %d tokens, want 2", got)
	}
	if len(fake.authHeaders) != 2 || fake.authHeaders[1] != "Bearer token-2" {
		t.Errorf("Authorization headers = %v, want the retry to carry the new token", fake.authHeaders)
	}
}

func TestSearchReportsAFailedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" {
			_, _ = io.WriteString(w, `{"access_token":"t","expires_in":5000000}`)
			return
		}
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"message":"Too Many Requests"}`)
	}))
	t.Cleanup(server.Close)

	client := New("id", "secret")
	client.tokenURL = server.URL + "/token"
	client.apiURL = server.URL + "/v4"

	_, err := client.Search(context.Background(), "Celeste")
	if err == nil || !strings.Contains(err.Error(), "status 429") {
		t.Errorf("err = %v, want one naming status 429", err)
	}
}

func TestCompanyURL(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"access_token":"t","expires_in":5000000}`)
	})
	var query string
	mux.HandleFunc("POST /v4/companies", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		query = string(body)
		switch {
		case strings.Contains(query, "where id = 37;"):
			_, _ = io.WriteString(w, `[{"id":37,"url":"https://www.igdb.com/companies/capcom"}]`)
		case strings.Contains(query, "where id = 66;"):
			_, _ = io.WriteString(w, `[{"id":66,"url":"https://elsewhere.example/capcom"}]`)
		default:
			_, _ = io.WriteString(w, `[]`)
		}
	})
	fake.server.Config.Handler = mux
	client := fake.client()

	url, err := client.CompanyURL(context.Background(), 37)
	if err != nil || url != "https://www.igdb.com/companies/capcom" {
		t.Errorf("CompanyURL(37) = %q, %v", url, err)
	}
	if !strings.Contains(query, "fields url;") {
		t.Errorf("query = %q, want it to ask for the url", query)
	}
	if _, err := client.CompanyURL(context.Background(), 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("CompanyURL(1) err = %v, want ErrNotFound", err)
	}
	if _, err := client.CompanyURL(context.Background(), 66); err == nil {
		t.Error("CompanyURL(66) followed a URL outside igdb.com")
	}
}

// A game's page comes from the games endpoint, and has to be a game page:
// the prefix differs from a company's.
func TestGameURL(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"access_token":"t","expires_in":5000000}`)
	})
	mux.HandleFunc("POST /v4/games", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch query := string(body); {
		case strings.Contains(query, "where id = 26192;"):
			_, _ = io.WriteString(w, `[{"id":26192,"url":"https://www.igdb.com/games/resident-evil-4--1"}]`)
		case strings.Contains(query, "where id = 37;"):
			_, _ = io.WriteString(w, `[{"id":37,"url":"https://www.igdb.com/companies/capcom"}]`)
		default:
			_, _ = io.WriteString(w, `[]`)
		}
	})
	fake.server.Config.Handler = mux
	client := fake.client()

	url, err := client.GameURL(context.Background(), 26192)
	if err != nil || url != "https://www.igdb.com/games/resident-evil-4--1" {
		t.Errorf("GameURL(26192) = %q, %v", url, err)
	}
	if _, err := client.GameURL(context.Background(), 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("GameURL(1) err = %v, want ErrNotFound", err)
	}
	if _, err := client.GameURL(context.Background(), 37); err == nil {
		t.Error("GameURL(37) followed a URL that is not a game page")
	}
}

func TestCompanies(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"access_token":"t","expires_in":5000000}`)
	})
	var query string
	mux.HandleFunc("POST /v4/companies", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		query = string(body)
		// IGDB answers in an order of its own.
		_, _ = io.WriteString(w, `[{"id":37,"name":"Capcom","country":392},{"id":70,"name":"Nintendo","country":392},{"id":1,"name":"Gone","country":810}]`)
	})
	fake.server.Config.Handler = mux

	companies, err := fake.client().Companies(context.Background(), []uint64{70, 1, 37})
	if err != nil {
		t.Fatalf("Companies: %v", err)
	}
	if !strings.Contains(query, "fields name,country;") || !strings.Contains(query, "where id = (70,1,37);") {
		t.Errorf("query = %q, want the names and countries of the three ids", query)
	}
	// A numeric code ISO 3166-1 no longer has is no country at all.
	want := []Company{{70, "Nintendo", "JP"}, {1, "Gone", ""}, {37, "Capcom", "JP"}}
	if !slices.Equal(companies, want) {
		t.Errorf("companies = %v, want %v, in the order asked for", companies, want)
	}
}

func TestImages(t *testing.T) {
	fake := newFakeIGDB(t, `[{
		"id": 26192,
		"cover": {"id": 1, "image_id": "co6bo0", "width": 1200, "height": 1600},
		"artworks": [
			{"id": 2, "image_id": "ar1", "width": 3840, "height": 2160},
			{"id": 3, "image_id": ""}
		]
	}]`)

	images, err := fake.client().Images(context.Background(), 26192)
	if err != nil {
		t.Fatalf("Images: %v", err)
	}
	want := []Image{
		{
			URL:      "https://images.igdb.com/igdb/image/upload/t_original/co6bo0.jpg",
			ThumbURL: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co6bo0.jpg",
			Width:    1200, Height: 1600, Kind: KindCover,
		},
		{
			URL:      "https://images.igdb.com/igdb/image/upload/t_original/ar1.jpg",
			ThumbURL: "https://images.igdb.com/igdb/image/upload/t_screenshot_big/ar1.jpg",
			Width:    3840, Height: 2160, Kind: KindArtwork,
		},
	}
	if len(images) != len(want) {
		t.Fatalf("images = %+v, want %+v", images, want)
	}
	for i := range want {
		if images[i] != want[i] {
			t.Errorf("images[%d] = %+v, want %+v", i, images[i], want[i])
		}
	}
	if !strings.Contains(fake.queries[0], "where id = 26192;") {
		t.Errorf("query = %q, want it to ask for the game by id", fake.queries[0])
	}
}

func TestImagesOfAnUnknownGame(t *testing.T) {
	fake := newFakeIGDB(t, `[]`)

	if _, err := fake.client().Images(context.Background(), 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}
