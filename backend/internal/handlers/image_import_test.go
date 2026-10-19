package handlers_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/mperezfo/gamelog/internal/handlers"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// toServer sends every request to server, whatever host it was for, so that
// a test can answer for IGDB's and SteamGridDB's image hosts. The request
// keeps its own URL otherwise, which is what the redirect check sees.
type toServer struct {
	server *httptest.Server
}

func (s toServer) RoundTrip(req *http.Request) (*http.Response, error) {
	target, _ := url.Parse(s.server.URL)
	out := req.Clone(req.Context())
	out.URL.Scheme = target.Scheme
	out.URL.Host = target.Host
	return http.DefaultTransport.RoundTrip(out)
}

func TestImageImport(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/cover.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(onePixelPNG)
	})
	mux.HandleFunc("/page.html", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("<!doctype html><title>not an image</title>"))
	})
	mux.HandleFunc("/huge.png", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(append(onePixelPNG, bytes.Repeat([]byte{0}, 9<<20)...))
	})
	mux.HandleFunc("/within", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://cdn2.steamgriddb.com/cover.png", http.StatusFound)
	})
	mux.HandleFunc("/outside", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://intranet.example/secret.png", http.StatusFound)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	db := testsupport.NewDatabase(t)
	handler := signedIn(t, newSourcesRouter(db, handlers.Sources{
		ImageClient: &http.Client{Transport: toServer{server}},
	}), db, "player", false)

	importImage := func(from string, want int) string {
		t.Helper()
		rec := request(t, handler, http.MethodPost, "/api/images/import", map[string]string{"url": from})
		expectStatus(t, rec, want, "importing "+from)
		var body struct {
			URL string `json:"url"`
		}
		if want == http.StatusCreated {
			decode(t, rec, &body)
		}
		return body.URL
	}

	stored := importImage("https://images.igdb.com/cover.png", http.StatusCreated)
	if stored == "" {
		t.Fatal("the import returned no URL")
	}
	fetched := request(t, handler, http.MethodGet, stored, nil)
	expectStatus(t, fetched, http.StatusOK, "fetching the imported image")
	if !bytes.Equal(fetched.Body.Bytes(), onePixelPNG) {
		t.Error("the imported image is not the downloaded one")
	}
	// The same image from SteamGridDB, through a redirect within its hosts,
	// lands on the same file.
	if again := importImage("https://cdn2.steamgriddb.com/within", http.StatusCreated); again != stored {
		t.Errorf("importing the same bytes again = %q, want %q", again, stored)
	}

	// Anywhere but the image hosts is turned down before anything is fetched.
	importImage("https://intranet.example/cover.png", http.StatusUnprocessableEntity)
	importImage("http://images.igdb.com/cover.png", http.StatusUnprocessableEntity)
	importImage("https://images.igdb.com:8443/cover.png", http.StatusUnprocessableEntity)
	importImage("https://images.igdb.com.example/cover.png", http.StatusUnprocessableEntity)
	importImage("https://steamgriddb.com.example/cover.png", http.StatusUnprocessableEntity)
	importImage("not a url", http.StatusUnprocessableEntity)

	importImage("https://cdn2.steamgriddb.com/outside", http.StatusFailedDependency)
	importImage("https://images.igdb.com/missing.png", http.StatusFailedDependency)
	importImage("https://images.igdb.com/page.html", http.StatusUnprocessableEntity)
	importImage("https://images.igdb.com/huge.png", http.StatusRequestEntityTooLarge)
}
