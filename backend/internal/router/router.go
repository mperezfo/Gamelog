// Package router defines the application's HTTP route tree.
package router

import (
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/config"
	"github.com/mperezfo/gamelog/internal/handlers"
	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/steamgriddb"
)

// Version is the version of the API reported in the OpenAPI document. It is
// the contract's version, not the build's: bump it when the API changes.
const Version = "0.3.0"

// Title names the API in the OpenAPI document and on the page that reads it.
const Title = "Gamelog API"

// Paths of the API documentation. They live under /api like everything else
// the backend serves, so the Vite dev proxy and whatever
// serves the static frontend in production route them to the backend with no
// extra rule.
const (
	// OpenAPIPath is served with both a .json and a .yaml extension.
	OpenAPIPath = "/api/openapi"
	// DocsPath is the documentation page: Stoplight Elements reading the
	// document next door, with a console that issues real requests. It is
	// served by docs.go rather than by Huma, which renders the same component
	// but gives no say over how.
	DocsPath = "/api/docs"
	// SchemasPath serves each schema on its own, for editors that follow the
	// $schema field of a response.
	SchemasPath = "/api/schemas"
)

// New builds the API router.
//
// The backend serves /api/* only: the frontend is an independent static build,
// so nothing here serves files or templates.
func New(cfg config.Config, db *gorm.DB, authentication *auth.Service, version string) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	// The client's address, for the request log, is read from X-Forwarded-For
	// only when the request comes from loopback, which is Caddy in the image:
	// a header a client sends itself is never believed.
	r.Use(middleware.ClientIPFromXFF("127.0.0.0/8", "::1/128"))
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(requestTimeout(RequestTimeout))

	// Huma owns the routes below this point: every operation is registered
	// against the OpenAPI description of the API, which is generated from the
	// same Go types that validate the requests (see the handlers package).
	api := humachi.New(r, openAPIConfig())
	handlers.Register(api, db, authentication, cfg.ImagesDir, version, handlers.Sources{
		IGDB:        igdbSource(cfg),
		SteamGridDB: steamGridDBSource(cfg),
	})

	// Outside Huma, since the page is ours. Left out, the route simply does
	// not exist: the documentation is what grants a stranger a console onto
	// the API, while the document next door only describes it.
	if cfg.DocsEnabled {
		r.Get(DocsPath, docsHandler())
	}

	return r
}

// RequestTimeout is how long a request may take before its context is
// cancelled and it is answered 504, except for the ones requestTimeout lets
// run.
const RequestTimeout = 30 * time.Second

// untimed are the requests that load a whole library, which requestTimeout
// leaves without a deadline: a backup carries every game and every image, an
// import every game, and both are written in one transaction that a large
// library cannot be expected to finish in the time any other request gets.
var untimed = map[string]bool{
	http.MethodPost + " /api/backup": true,
	http.MethodPost + " /api/import": true,
}

// requestTimeout bounds every request to timeout, but those in untimed.
func requestTimeout(timeout time.Duration) func(http.Handler) http.Handler {
	bounded := middleware.Timeout(timeout)
	return func(next http.Handler) http.Handler {
		limited := bounded(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if untimed[r.Method+" "+r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

// igdbSource builds the IGDB client when the deployment has credentials for
// it, and returns nil otherwise. The nil is an untyped one on purpose: a nil
// *igdb.Client inside the interface would not compare equal to nil, and the
// handlers would take IGDB for configured.
func igdbSource(cfg config.Config) handlers.IGDB {
	if !cfg.IGDBEnabled() {
		return nil
	}
	return igdb.New(cfg.IGDBClientID, cfg.IGDBClientSecret, cfg.IGDBSearchLimit)
}

// steamGridDBSource builds the SteamGridDB client when the deployment has a
// key for it, and returns an untyped nil otherwise, for the same reason as
// igdbSource.
func steamGridDBSource(cfg config.Config) handlers.SteamGridDB {
	if !cfg.SteamGridDBEnabled() {
		return nil
	}
	return steamgriddb.New(cfg.SteamGridDBAPIKey)
}

// openAPIConfig describes the API document itself.
func openAPIConfig() huma.Config {
	cfg := huma.DefaultConfig(Title, Version)

	cfg.OpenAPIPath = OpenAPIPath
	cfg.SchemasPath = SchemasPath

	// An empty path keeps Huma from registering a documentation page of its
	// own: this application serves one it can steer, from docs.go.
	cfg.DocsPath = ""

	cfg.Info.Description = "REST API of Gamelog, a self-hosted game tracker.\n\n" +
		"Every path is relative to the origin serving this document, so the " +
		"requests issued from this page go to the same deployment you are " +
		"reading it on.\n\n" +
		"Everything but logging in and the first-run setup needs a session. A " +
		"session is an `HttpOnly` cookie that `POST /api/auth/login` sets, which a " +
		"browser then sends on its own — including from the console on this page, " +
		"once you have logged in through it. Each account sees only its own: games, " +
		"and the genres, developers, publishers and platforms it created."

	// No `servers` list on purpose: with none, a client resolves the paths
	// against the origin the document was served from. That is what makes the
	// same document correct in development, in a test deployment and in
	// production without a per-environment base URL.

	return cfg
}
