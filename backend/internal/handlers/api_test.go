package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/config"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/router"
)

// request performs a JSON request against handler. A nil body sends none.
func request(t *testing.T, handler http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()

	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("encoding the request body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}

	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// expectStatus fails the test unless the response carries the wanted status,
// reporting the body, which for an error is a problem detail explaining why.
func expectStatus(t *testing.T, rec *httptest.ResponseRecorder, want int, context string) {
	t.Helper()

	if rec.Code != want {
		t.Fatalf("%s: status = %d, want %d; body: %s", context, rec.Code, want, rec.Body.String())
	}
}

// decode reads a JSON response body into target.
func decode(t *testing.T, rec *httptest.ResponseRecorder, target any) {
	t.Helper()

	if err := json.Unmarshal(rec.Body.Bytes(), target); err != nil {
		t.Fatalf("response is not valid JSON: %v; body: %s", err, rec.Body.String())
	}
}

// testSessionLifetime is long enough that nothing under test expires, and
// short enough to be obviously a test value.
const testSessionLifetime = time.Hour

// newBareRouter builds the router under test with nobody signed in.
//
// The database is only touched while serving a request, so the tests about the
// OpenAPI document itself pass nil.
func newBareRouter(db *gorm.DB, docsEnabled bool) http.Handler {
	// The system temp dir is good enough here: filenames are content-addressed,
	// so tests sharing it cannot collide on anything that matters.
	cfg := config.Config{DocsEnabled: docsEnabled, SessionLifetime: testSessionLifetime, ImagesDir: os.TempDir()}
	return router.New(cfg, db, newAuthService(db), "test")
}

// newAuthService builds an authentication service on the same database the
// router uses. A session opened through one instance resolves through another:
// sessions are rows, not something held in memory.
func newAuthService(db *gorm.DB) *auth.Service {
	return auth.NewService(db, auth.Options{Lifetime: testSessionLifetime})
}

// newRouter builds the router under test, already signed in as a regular
// account.
//
// Every operation but logging in and the first run needs a session, so a test
// about games or genres would otherwise spend its first half logging in. What
// those tests are about is the resource, not who is asking; the tests about
// authentication itself use newBareRouter and sign in explicitly.
func newRouter(t *testing.T, db *gorm.DB, docsEnabled bool) http.Handler {
	t.Helper()

	handler := newBareRouter(db, docsEnabled)
	if db == nil {
		// Nothing reaches a handler, so there is nobody to be.
		return handler
	}
	return signedIn(t, handler, db, "player", false)
}

// signedIn creates an account and wraps handler so that every request carries
// its session.
func signedIn(t *testing.T, handler http.Handler, db *gorm.DB, username string, admin bool) http.Handler {
	t.Helper()

	service := newAuthService(db)
	ctx := context.Background()

	hash, err := auth.HashPassword(testPassword)
	if err != nil {
		t.Fatalf("hashing the test password: %v", err)
	}

	user := &models.User{Username: username, PasswordHash: hash, IsAdmin: admin}
	if err := service.Users().Create(ctx, user); err != nil {
		t.Fatalf("creating the %q account: %v", username, err)
	}

	session, err := service.Open(ctx, user.ID)
	if err != nil {
		t.Fatalf("opening a session for %q: %v", username, err)
	}

	cookie := service.Cookie(session)
	return sessionHandler{handler: handler, cookie: &cookie}
}

// testPassword is the password every account in these tests is created with.
const testPassword = "a good enough password"

// sessionHandler adds a session cookie to every request that does not already
// carry one.
type sessionHandler struct {
	handler http.Handler
	cookie  *http.Cookie
}

func (s sessionHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if _, err := r.Cookie(auth.CookieName); err != nil {
		r.AddCookie(s.cookie)
	}
	s.handler.ServeHTTP(w, r)
}

// itoa renders an id for a URL.
func itoa(id uint64) string { return strconv.FormatUint(id, 10) }

// containsAny reports whether body mentions any of the words, case-insensitively.
// It is how a test checks that a response does not leak password material.
func containsAny(body string, words ...string) bool {
	lower := strings.ToLower(body)
	for _, word := range words {
		if strings.Contains(lower, word) {
			return true
		}
	}
	return false
}
