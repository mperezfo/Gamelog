package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// login signs in through the API and returns the session cookie it set.
func login(t *testing.T, handler http.Handler, username, password string) *http.Cookie {
	t.Helper()

	rec := request(t, handler, http.MethodPost, "/api/auth/login", map[string]string{
		"username": username,
		"password": password,
	})
	expectStatus(t, rec, http.StatusOK, "login")

	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == auth.CookieName && cookie.Value != "" {
			return cookie
		}
	}
	t.Fatal("logging in set no session cookie")
	return nil
}

// requestAs performs a request carrying one particular session.
func requestAs(
	t *testing.T,
	handler http.Handler,
	cookie *http.Cookie,
	method, target string,
	body any,
) *httptest.ResponseRecorder {
	t.Helper()
	return request(t, sessionHandler{handler: handler, cookie: cookie}, method, target, body)
}

func TestFirstRunCreatesTheAdminOnceOnly(t *testing.T) {
	handler := newBareRouter(testsupport.NewDatabase(t), false)

	var status struct {
		Pending       bool   `json:"pending"`
		AdminUsername string `json:"admin_username"`
	}
	rec := request(t, handler, http.MethodGet, "/api/setup", nil)
	expectStatus(t, rec, http.StatusOK, "setup status on a fresh deployment")
	decode(t, rec, &status)

	if !status.Pending {
		t.Fatal("a deployment with no accounts does not report the first run as pending")
	}
	if status.AdminUsername != auth.AdminUsername {
		t.Fatalf("admin_username = %q, want %q", status.AdminUsername, auth.AdminUsername)
	}

	rec = request(t, handler, http.MethodPost, "/api/setup", map[string]string{
		"password": testPassword,
	})
	expectStatus(t, rec, http.StatusCreated, "creating the admin")

	var admin struct {
		Username string `json:"username"`
		IsAdmin  bool   `json:"is_admin"`
	}
	decode(t, rec, &admin)
	if admin.Username != auth.AdminUsername || !admin.IsAdmin {
		t.Fatalf("setup created %+v, want the admin account", admin)
	}

	// The answer signs the browser in, so the admin lands in the application
	// rather than on a login screen it would have to fill in again.
	if len(rec.Result().Cookies()) == 0 {
		t.Fatal("setup did not open a session")
	}

	rec = request(t, handler, http.MethodGet, "/api/setup", nil)
	expectStatus(t, rec, http.StatusOK, "setup status after the first run")
	decode(t, rec, &status)
	if status.Pending {
		t.Fatal("the first run is still reported as pending after creating the admin")
	}

	// The window is shut for good: otherwise anybody reaching the deployment
	// could hand themselves a second admin account.
	rec = request(t, handler, http.MethodPost, "/api/setup", map[string]string{
		"password": "another password entirely",
	})
	expectStatus(t, rec, http.StatusConflict, "running setup twice")
}

func TestRequestsWithoutASessionAreRefused(t *testing.T) {
	db := testsupport.NewDatabase(t)
	handler := newBareRouter(db, false)

	// The health check is public: a compose healthcheck has no session.
	expectStatus(t, request(t, handler, http.MethodGet, "/api/health", nil),
		http.StatusOK, "health check without a session")

	for _, target := range []string{"/api/games", "/api/genres", "/api/export", "/api/users", "/api/auth/me"} {
		expectStatus(t, request(t, handler, http.MethodGet, target, nil),
			http.StatusUnauthorized, "GET "+target+" without a session")
	}

	signedIn(t, handler, db, "player", false)

	// An unknown username and a wrong password are the same answer.
	for _, credentials := range []map[string]string{
		{"username": "player", "password": "not the password"},
		{"username": "nobody", "password": testPassword},
	} {
		expectStatus(t, request(t, handler, http.MethodPost, "/api/auth/login", credentials),
			http.StatusUnauthorized, "logging in with bad credentials")
	}

	// Logging out without a session is not a failure: a browser whose session
	// has already ended still has a cookie to be told to drop.
	expectStatus(t, request(t, handler, http.MethodPost, "/api/auth/logout", nil),
		http.StatusNoContent, "logging out without a session")

	// A token that was never issued is refused like any other.
	expectStatus(t,
		requestAs(t, handler, &http.Cookie{Name: auth.CookieName, Value: "made up"},
			http.MethodGet, "/api/games", nil),
		http.StatusUnauthorized, "a made-up session token")
}

func TestTheAdminManagesAccountsAndOwnsNoLibrary(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)

	admin := signedIn(t, bare, db, auth.AdminUsername, true)
	player := signedIn(t, bare, db, "player", false)

	// The admin has no library: the invariant is enforced by the API rather
	// than left to the frontend to observe.
	for _, target := range []string{"/api/games", "/api/genres", "/api/export"} {
		expectStatus(t, request(t, admin, http.MethodGet, target, nil),
			http.StatusForbidden, "the admin reading "+target)
	}

	// And a regular account manages nobody.
	expectStatus(t, request(t, player, http.MethodGet, "/api/users", nil),
		http.StatusForbidden, "a regular account listing the accounts")

	rec := request(t, admin, http.MethodPost, "/api/users", map[string]string{
		"username": "someone",
		"password": testPassword,
	})
	expectStatus(t, rec, http.StatusCreated, "the admin creating an account")

	var created struct {
		ID      uint64 `json:"id"`
		IsAdmin bool   `json:"is_admin"`
	}
	decode(t, rec, &created)
	if created.IsAdmin {
		t.Fatal("an account created through /api/users came out as an admin")
	}

	// A hash must never reach a response, whatever the account. Checking for
	// the field name rather than the bare word "password" is what keeps this
	// from tripping over must_change_password, which is not the hash itself.
	if body := rec.Body.String(); containsAny(body, "password_hash", "\"hash\"") {
		t.Fatalf("the created account leaks password material: %s", body)
	}

	expectStatus(t, request(t, admin, http.MethodPost, "/api/users", map[string]string{
		"username": "SOMEONE",
		"password": testPassword,
	}), http.StatusConflict, "reusing an account name in another case")

	expectStatus(t, request(t, admin, http.MethodDelete, "/api/users/"+itoa(created.ID), nil),
		http.StatusNoContent, "the admin deleting an account")
}

func TestLibrariesAreSeparate(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)

	alice := signedIn(t, bare, db, "alice", false)
	bob := signedIn(t, bare, db, "bob", false)

	rec := request(t, alice, http.MethodPost, "/api/games", map[string]any{
		"title":    "Hollow Knight",
		"status":   "played",
		"position": 1,
	})
	expectStatus(t, rec, http.StatusCreated, "alice creating a game")

	var game struct {
		ID uint64 `json:"id"`
	}
	decode(t, rec, &game)

	var mine []map[string]any
	rec = request(t, alice, http.MethodGet, "/api/games", nil)
	expectStatus(t, rec, http.StatusOK, "alice listing her games")
	decode(t, rec, &mine)
	if len(mine) != 1 {
		t.Fatalf("alice sees %d games, want 1", len(mine))
	}

	var theirs []map[string]any
	rec = request(t, bob, http.MethodGet, "/api/games", nil)
	expectStatus(t, rec, http.StatusOK, "bob listing his games")
	decode(t, rec, &theirs)
	if len(theirs) != 0 {
		t.Fatalf("bob sees %d of alice's games, want 0", len(theirs))
	}

	// Somebody else's id does not exist rather than being forbidden: there is
	// nothing to learn from a 404 about whether the game is there.
	target := "/api/games/" + itoa(game.ID)
	expectStatus(t, request(t, bob, http.MethodGet, target, nil),
		http.StatusNotFound, "bob reading alice's game")
	expectStatus(t, request(t, bob, http.MethodDelete, target, nil),
		http.StatusNotFound, "bob deleting alice's game")
	expectStatus(t, request(t, bob, http.MethodPut, target, map[string]any{
		"title": "Not yours", "status": "pending", "position": 1,
	}), http.StatusNotFound, "bob overwriting alice's game")

	// Alice's export is hers alone, and bob's is empty.
	var export struct {
		Games []map[string]any `json:"games"`
	}
	rec = request(t, bob, http.MethodGet, "/api/export", nil)
	expectStatus(t, rec, http.StatusOK, "bob exporting")
	decode(t, rec, &export)
	if len(export.Games) != 0 {
		t.Fatalf("bob's export carries %d of alice's games, want 0", len(export.Games))
	}
}

// TestLookupsAreSeparate is TestLibrariesAreSeparate's equivalent for the
// four simple entities, since migration 00013 made them one account's own
// records instead of shared ones.
func TestLookupsAreSeparate(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)

	alice := signedIn(t, bare, db, "alice", false)
	bob := signedIn(t, bare, db, "bob", false)

	rec := request(t, alice, http.MethodPost, "/api/genres", map[string]any{"name": "Metroidvania"})
	expectStatus(t, rec, http.StatusCreated, "alice creating a genre")

	var genre struct {
		ID uint64 `json:"id"`
	}
	decode(t, rec, &genre)

	// Bob is free to use the same name: uniqueness is per account now.
	rec = request(t, bob, http.MethodPost, "/api/genres", map[string]any{"name": "Metroidvania"})
	expectStatus(t, rec, http.StatusCreated, "bob creating a genre with the same name alice already uses")

	var theirs []map[string]any
	rec = request(t, bob, http.MethodGet, "/api/genres", nil)
	expectStatus(t, rec, http.StatusOK, "bob listing his genres")
	decode(t, rec, &theirs)
	if len(theirs) != 1 {
		t.Fatalf("bob sees %d genres, want 1 (his own, not alice's)", len(theirs))
	}

	target := "/api/genres/" + itoa(genre.ID)
	expectStatus(t, request(t, bob, http.MethodGet, target, nil),
		http.StatusNotFound, "bob reading alice's genre")
	expectStatus(t, request(t, bob, http.MethodDelete, target, nil),
		http.StatusNotFound, "bob deleting alice's genre")
	expectStatus(t, request(t, bob, http.MethodPut, target, map[string]any{"name": "Not yours"}),
		http.StatusNotFound, "bob renaming alice's genre")

	// A game cannot borrow another account's genre either.
	rec = request(t, bob, http.MethodPost, "/api/games", map[string]any{
		"title":     "Hollow Knight",
		"status":    "played",
		"position":  1,
		"genre_ids": []uint64{genre.ID},
	})
	expectStatus(t, rec, http.StatusUnprocessableEntity, "bob creating a game with alice's genre id")
}

func TestDeletingALookupInUseIsRefused(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)
	player := signedIn(t, bare, db, "player", false)

	rec := request(t, player, http.MethodPost, "/api/genres", map[string]any{"name": "Metroidvania"})
	expectStatus(t, rec, http.StatusCreated, "creating a genre")

	var genre struct {
		ID uint64 `json:"id"`
	}
	decode(t, rec, &genre)

	rec = request(t, player, http.MethodPost, "/api/games", map[string]any{
		"title":     "Hollow Knight",
		"status":    "played",
		"position":  1,
		"genre_ids": []uint64{genre.ID},
	})
	expectStatus(t, rec, http.StatusCreated, "creating a game with that genre")

	var game struct {
		ID uint64 `json:"id"`
	}
	decode(t, rec, &game)

	// Without the refusal the join table would cascade and the genre would
	// vanish from the game without anybody asking for that.
	expectStatus(t, request(t, player, http.MethodDelete, "/api/genres/"+itoa(genre.ID), nil),
		http.StatusConflict, "deleting a genre a game still carries")

	expectStatus(t, request(t, player, http.MethodDelete, "/api/games/"+itoa(game.ID), nil),
		http.StatusNoContent, "deleting the game")
	expectStatus(t, request(t, player, http.MethodDelete, "/api/genres/"+itoa(genre.ID), nil),
		http.StatusNoContent, "deleting the genre once nothing uses it")
}

func TestChangingAPasswordEndsTheOtherSessions(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)
	signedIn(t, bare, db, "player", false)

	phone := login(t, bare, "player", testPassword)
	laptop := login(t, bare, "player", testPassword)

	expectStatus(t, requestAs(t, bare, phone, http.MethodGet, "/api/auth/me", nil),
		http.StatusOK, "the phone before the change")

	expectStatus(t, requestAs(t, bare, laptop, http.MethodPut, "/api/auth/password", map[string]string{
		"current_password": "not the current one",
		"new_password":     "a brand new password",
	}), http.StatusUnauthorized, "changing a password without knowing the old one")

	rec := requestAs(t, bare, laptop, http.MethodPut, "/api/auth/password", map[string]string{
		"current_password": testPassword,
		"new_password":     "a brand new password",
	})
	expectStatus(t, rec, http.StatusOK, "changing a password")

	// The browser doing the change gets a fresh session, so it stays logged
	// in; every other one is out.
	var replacement *http.Cookie
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == auth.CookieName && cookie.Value != "" {
			replacement = cookie
		}
	}
	if replacement == nil {
		t.Fatal("changing a password did not hand back a new session")
	}

	expectStatus(t, requestAs(t, bare, replacement, http.MethodGet, "/api/auth/me", nil),
		http.StatusOK, "the laptop after the change")
	expectStatus(t, requestAs(t, bare, phone, http.MethodGet, "/api/auth/me", nil),
		http.StatusUnauthorized, "the phone after the change")
	expectStatus(t, requestAs(t, bare, laptop, http.MethodGet, "/api/auth/me", nil),
		http.StatusUnauthorized, "the laptop's old session after the change")

	// And logging out ends the one that is left.
	expectStatus(t, requestAs(t, bare, replacement, http.MethodPost, "/api/auth/logout", nil),
		http.StatusNoContent, "logging out")
	expectStatus(t, requestAs(t, bare, replacement, http.MethodGet, "/api/auth/me", nil),
		http.StatusUnauthorized, "after logging out")
}

// TestNameDefaultsToUsernameButCanDiverge is the point of splitting the two:
// an account starts with them equal, and a self-service profile update can
// change the one shown in the application without touching the one used to
// sign in.
func TestNameDefaultsToUsernameButCanDiverge(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)
	handler := signedIn(t, bare, db, "player", false)

	me := request(t, handler, http.MethodGet, "/api/auth/me", nil)
	expectStatus(t, me, http.StatusOK, "reading your own account")
	var before models.User
	decode(t, me, &before)
	if before.Name != "player" {
		t.Errorf("name = %q, want it to default to the username %q", before.Name, "player")
	}

	avatar := "/api/images/deadbeef.jpg"
	updated := request(t, handler, http.MethodPut, "/api/auth/profile", map[string]any{
		"name":       "Player One",
		"avatar_url": avatar,
	})
	expectStatus(t, updated, http.StatusOK, "updating your own profile")

	var after models.User
	decode(t, updated, &after)
	if after.Name != "Player One" {
		t.Errorf("name = %q, want %q", after.Name, "Player One")
	}
	if after.AvatarURL == nil || *after.AvatarURL != avatar {
		t.Errorf("avatar_url = %v, want %q", after.AvatarURL, avatar)
	}
	if after.Username != "player" {
		t.Errorf("username = %q, want it unchanged by a profile update", after.Username)
	}
}

func TestPreferencesDefaultAndCanBeChanged(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)
	handler := signedIn(t, bare, db, "player", false)

	me := request(t, handler, http.MethodGet, "/api/auth/me", nil)
	expectStatus(t, me, http.StatusOK, "reading your own account")
	var before models.User
	decode(t, me, &before)
	if before.Theme != "system" {
		t.Errorf("theme = %q, want it to default to %q", before.Theme, "system")
	}
	if before.DateFormat != "long" {
		t.Errorf("date_format = %q, want it to default to %q", before.DateFormat, "long")
	}
	if before.GamesView != "table" {
		t.Errorf("games_view = %q, want it to default to %q", before.GamesView, "table")
	}

	updated := request(t, handler, http.MethodPut, "/api/auth/preferences", map[string]any{
		"theme":       "dark",
		"date_format": "ymd",
		"games_view":  "grid",
	})
	expectStatus(t, updated, http.StatusOK, "updating your own preferences")

	var after models.User
	decode(t, updated, &after)
	if after.Theme != "dark" {
		t.Errorf("theme = %q, want %q", after.Theme, "dark")
	}
	if after.DateFormat != "ymd" {
		t.Errorf("date_format = %q, want %q", after.DateFormat, "ymd")
	}
	if after.GamesView != "grid" {
		t.Errorf("games_view = %q, want %q", after.GamesView, "grid")
	}

	// The change is durable, not just echoed back in the same response.
	again := request(t, handler, http.MethodGet, "/api/auth/me", nil)
	var reread models.User
	decode(t, again, &reread)
	if reread.Theme != "dark" || reread.DateFormat != "ymd" || reread.GamesView != "grid" {
		t.Errorf("preferences did not persist: theme = %q, date_format = %q, games_view = %q", reread.Theme, reread.DateFormat, reread.GamesView)
	}
}
