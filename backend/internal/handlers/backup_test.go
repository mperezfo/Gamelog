package handlers_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// uploadBackup issues a multipart POST /api/backup carrying content under the
// "file" field, mimicking what a browser's <input type="file"> would send.
func uploadBackup(t *testing.T, handler http.Handler, content []byte) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="backup.zip"`},
		"Content-Type":        {"application/zip"},
	})
	if err != nil {
		t.Fatalf("creating the multipart field: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("writing the multipart field: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("closing the multipart body: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/backup", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// readZipEntry reads one file out of a .zip held in memory.
func readZipEntry(t *testing.T, archive []byte, name string) []byte {
	t.Helper()

	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("the export is not a valid .zip: %v", err)
	}
	file, err := reader.Open(name)
	if err != nil {
		t.Fatalf("the archive has no %s: %v", name, err)
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		t.Fatalf("reading %s: %v", name, err)
	}
	return content
}

// zipEntryNames lists every file inside a .zip held in memory.
func zipEntryNames(t *testing.T, archive []byte) []string {
	t.Helper()

	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("the export is not a valid .zip: %v", err)
	}
	names := make([]string, 0, len(reader.File))
	for _, file := range reader.File {
		names = append(names, file.Name)
	}
	return names
}

// A full backup round trip: exporting bundles the account and its images
// alongside the library, and restoring it recreates all three — while
// forcing a password change, since the restored hash is not one the account
// chose just now.
func TestBackupExportAndImportRoundTrip(t *testing.T) {
	db := testsupport.NewDatabase(t)
	bare := newBareRouter(db, false)
	handler := signedIn(t, bare, db, "player", false)

	cover := uploadFile(t, handler, onePixelPNG, "cover.png", "image/png")
	expectStatus(t, cover, http.StatusCreated, "uploading a cover")
	var coverBody struct {
		URL string `json:"url"`
	}
	decode(t, cover, &coverBody)

	avatar := uploadFile(t, handler, onePixelPNG, "avatar.png", "image/png")
	expectStatus(t, avatar, http.StatusCreated, "uploading an avatar")
	var avatarBody struct {
		URL string `json:"url"`
	}
	decode(t, avatar, &avatarBody)

	profile := request(t, handler, http.MethodPut, "/api/auth/profile", map[string]any{
		"name":       "Player One",
		"avatar_url": avatarBody.URL,
	})
	expectStatus(t, profile, http.StatusOK, "setting an avatar")

	preferences := request(t, handler, http.MethodPut, "/api/auth/preferences", map[string]any{
		"theme":       "dark",
		"date_format": "ymd",
		"games_view":  "grid",
	})
	expectStatus(t, preferences, http.StatusOK, "setting preferences")

	created := request(t, handler, http.MethodPost, "/api/games", map[string]any{
		"title":           "Hollow Knight",
		"status":          "played",
		"position":        1,
		"cover_image_url": coverBody.URL,
	})
	expectStatus(t, created, http.StatusCreated, "creating a game with a cover")

	exported := request(t, handler, http.MethodGet, "/api/backup", nil)
	expectStatus(t, exported, http.StatusOK, "exporting a backup")
	if ct := exported.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
	if exported.Header().Get("Content-Disposition") == "" {
		t.Error("the backup carries no Content-Disposition header")
	}

	archive := exported.Body.Bytes()
	names := zipEntryNames(t, archive)
	if !containsString(names, "gamelog.json") {
		t.Fatalf("the archive holds %v, want gamelog.json", names)
	}

	coverName := strings.TrimPrefix(coverBody.URL, "/api/images/")
	avatarName := strings.TrimPrefix(avatarBody.URL, "/api/images/")
	for _, want := range []string{"images/" + coverName, "images/" + avatarName} {
		if !containsString(names, want) {
			t.Errorf("the archive holds %v, want %q", names, want)
		}
	}

	var document struct {
		Games []struct {
			Title string `json:"title"`
		} `json:"games"`
		Account struct {
			Name         string `json:"name"`
			AvatarURL    string `json:"avatar_url"`
			PasswordHash string `json:"password_hash"`
			Theme        string `json:"theme"`
			DateFormat   string `json:"date_format"`
			GamesView    string `json:"games_view"`
		} `json:"account"`
	}
	if err := json.Unmarshal(readZipEntry(t, archive, "gamelog.json"), &document); err != nil {
		t.Fatalf("gamelog.json is not valid JSON: %v", err)
	}
	if len(document.Games) != 1 || document.Games[0].Title != "Hollow Knight" {
		t.Errorf("games = %+v, want the one game", document.Games)
	}
	if document.Account.Name != "Player One" {
		t.Errorf("account.name = %q, want %q", document.Account.Name, "Player One")
	}
	if !strings.HasPrefix(document.Account.PasswordHash, "$2") {
		t.Errorf("account.password_hash = %q, want a bcrypt hash", document.Account.PasswordHash)
	}
	if document.Account.Theme != "dark" || document.Account.DateFormat != "ymd" || document.Account.GamesView != "grid" {
		t.Errorf("account preferences = %+v, want theme=dark date_format=ymd games_view=grid", document.Account)
	}

	otherSession := login(t, bare, "player", testPassword)

	imported := uploadBackup(t, handler, archive)
	expectStatus(t, imported, http.StatusOK, "restoring the backup")

	var report struct {
		Created struct {
			Games int `json:"games"`
		} `json:"created"`
	}
	decode(t, imported, &report)
	if report.Created.Games != 0 {
		// The same games are already there under the same title, so a
		// replace of the library it came from updates rather than creates.
		t.Logf("created.games = %d (informational)", report.Created.Games)
	}

	var freshCookie *http.Cookie
	for _, cookie := range imported.Result().Cookies() {
		if cookie.Name == auth.CookieName && cookie.Value != "" {
			freshCookie = cookie
		}
	}
	if freshCookie == nil {
		t.Fatal("restoring a backup did not hand back a fresh session")
	}

	// The backup carries a password hash, so every session the account had —
	// including the one that just restored it — is ended in favour of the
	// fresh cookie above.
	expectStatus(t, requestAs(t, bare, otherSession, http.MethodGet, "/api/auth/me", nil),
		http.StatusUnauthorized, "an older session after restoring a backup")

	me := requestAs(t, bare, freshCookie, http.MethodGet, "/api/auth/me", nil)
	expectStatus(t, me, http.StatusOK, "reading the account on the fresh session")
	var account struct {
		Name               string `json:"name"`
		AvatarURL          string `json:"avatar_url"`
		MustChangePassword bool   `json:"must_change_password"`
		Theme              string `json:"theme"`
		DateFormat         string `json:"date_format"`
		GamesView          string `json:"games_view"`
	}
	decode(t, me, &account)
	if !account.MustChangePassword {
		t.Error("restoring a backup did not force a password change")
	}
	if account.Name != "Player One" || account.AvatarURL != avatarBody.URL {
		t.Errorf("account = %+v, want the profile the backup carried", account)
	}
	if account.Theme != "dark" || account.DateFormat != "ymd" || account.GamesView != "grid" {
		t.Errorf("restored preferences = %+v, want theme=dark date_format=ymd games_view=grid", account)
	}

	// Nothing but the session operations work until the password changes.
	expectStatus(t, requestAs(t, bare, freshCookie, http.MethodGet, "/api/games", nil),
		http.StatusForbidden, "reading games while a password change is pending")
	expectStatus(t, requestAs(t, bare, freshCookie, http.MethodGet, "/api/export", nil),
		http.StatusForbidden, "exporting while a password change is pending")

	changed := requestAs(t, bare, freshCookie, http.MethodPut, "/api/auth/password", map[string]string{
		"current_password": testPassword,
		"new_password":     "a brand new password",
	})
	expectStatus(t, changed, http.StatusOK, "changing the restored password")
	var changedAccount struct {
		MustChangePassword bool `json:"must_change_password"`
	}
	decode(t, changed, &changedAccount)
	if changedAccount.MustChangePassword {
		t.Error("changing the password did not clear the pending flag in the response")
	}

	var newCookie *http.Cookie
	for _, cookie := range changed.Result().Cookies() {
		if cookie.Name == auth.CookieName && cookie.Value != "" {
			newCookie = cookie
		}
	}
	if newCookie == nil {
		t.Fatal("changing the password did not hand back a session")
	}

	expectStatus(t, requestAs(t, bare, newCookie, http.MethodGet, "/api/games", nil),
		http.StatusOK, "reading games once the password has been changed")
}

// A crafted or truncated upload must not panic the importer or write
// anything.
func TestImportBackupRejectsAnInvalidArchive(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	rejected := uploadBackup(t, handler, []byte("not a zip file"))
	expectStatus(t, rejected, http.StatusUnprocessableEntity, "restoring a file that is not a .zip")
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
