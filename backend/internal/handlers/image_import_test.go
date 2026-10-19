package handlers_test

import (
	"bytes"
	"image"
	"image/png"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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
		_, _ = w.Write(append(onePixelPNG, bytes.Repeat([]byte{0}, 33<<20)...))
	})
	heavy := noisePNG(t, 4800, 600)
	mux.HandleFunc("/heavy.png", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(heavy)
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

	// Over the upload cap, but not the download one: stored reduced.
	if len(heavy) <= 8<<20 {
		t.Fatalf("the heavy image is %d bytes, which does not test the reduction", len(heavy))
	}
	reduced := importImage("https://cdn2.steamgriddb.com/heavy.png", http.StatusCreated)
	if !strings.HasSuffix(reduced, ".jpg") {
		t.Errorf("reduced image = %q, want a JPEG", reduced)
	}
	fetched = request(t, handler, http.MethodGet, reduced, nil)
	expectStatus(t, fetched, http.StatusOK, "fetching the reduced image")
	config, _, err := image.DecodeConfig(bytes.NewReader(fetched.Body.Bytes()))
	if err != nil {
		t.Fatalf("decoding the reduced image: %v", err)
	}
	if config.Width != 3840 || config.Height != 480 || fetched.Body.Len() > 8<<20 {
		t.Errorf("reduced image is %dx%d and %d bytes, want 3840x480 and under 8 MiB",
			config.Width, config.Height, fetched.Body.Len())
	}
}

// noisePNG encodes an opaque image of random pixels, which PNG cannot
// compress: about four bytes a pixel.
func noisePNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	random := rand.New(rand.NewPCG(1, 2))
	for i := range img.Pix {
		img.Pix[i] = byte(random.Uint32())
	}
	for i := 3; i < len(img.Pix); i += 4 {
		img.Pix[i] = 0xff
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encoding the noise image: %v", err)
	}
	return buf.Bytes()
}
