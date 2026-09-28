package handlers_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mperezfo/gamelog/internal/testsupport"
)

// onePixelPNG is the smallest valid PNG: a single transparent pixel. Real
// enough for http.DetectContentType and the decoder to agree it is an image.
var onePixelPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
	0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
	0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

// uploadFile issues a multipart POST /api/images carrying content under the
// "file" field, mimicking what a browser's <input type="file"> would send.
func uploadFile(t *testing.T, handler http.Handler, content []byte, filename, contentType string) *httptest.ResponseRecorder {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="` + filename + `"`},
		"Content-Type":        {contentType},
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

	req := httptest.NewRequest(http.MethodPost, "/api/images", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestImageUploadAndRetrieval(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	uploaded := uploadFile(t, handler, onePixelPNG, "cover.png", "image/png")
	expectStatus(t, uploaded, http.StatusCreated, "uploading a cover image")

	var body struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(uploaded.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v; body: %s", err, uploaded.Body.String())
	}
	if body.URL == "" {
		t.Fatal("upload response carried no URL")
	}

	fetched := request(t, handler, http.MethodGet, body.URL, nil)
	expectStatus(t, fetched, http.StatusOK, "fetching the uploaded image")
	if fetched.Header().Get("Content-Type") != "image/png" {
		t.Errorf("Content-Type = %q, want %q", fetched.Header().Get("Content-Type"), "image/png")
	}
	if !bytes.Equal(fetched.Body.Bytes(), onePixelPNG) {
		t.Error("fetched bytes did not match what was uploaded")
	}

	// Uploading the same bytes again must not create a second file: the URL
	// is the same one, and a game already pointing at it is unaffected.
	uploadedAgain := uploadFile(t, handler, onePixelPNG, "cover-copy.png", "image/png")
	expectStatus(t, uploadedAgain, http.StatusCreated, "uploading the same image again")

	var bodyAgain struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(uploadedAgain.Body.Bytes(), &bodyAgain); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if bodyAgain.URL != body.URL {
		t.Errorf("re-uploading the same bytes got %q, want the same URL %q", bodyAgain.URL, body.URL)
	}
}

func TestImageUploadRejectsAnUnsupportedType(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	rejected := uploadFile(t, handler, []byte("not an image"), "notes.txt", "text/plain")
	expectStatus(t, rejected, http.StatusUnprocessableEntity, "uploading a non-image file")
}

func TestGetImageRejectsAnUnknownOrCraftedName(t *testing.T) {
	handler := newRouter(t, testsupport.NewDatabase(t), false)

	for _, name := range []string{
		"does-not-exist.png",
		"../../../etc/passwd",
		"..%2f..%2fetc%2fpasswd",
	} {
		rec := request(t, handler, http.MethodGet, "/api/images/"+name, nil)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusBadRequest {
			t.Errorf("GET /api/images/%s: status = %d, want 404 or 400", name, rec.Code)
		}
	}
}

func TestImagesRequireASession(t *testing.T) {
	handler := newBareRouter(testsupport.NewDatabase(t), false)

	uploaded := uploadFile(t, handler, onePixelPNG, "cover.png", "image/png")
	expectStatus(t, uploaded, http.StatusUnauthorized, "uploading with no session")

	fetched := request(t, handler, http.MethodGet, "/api/images/anything.png", nil)
	expectStatus(t, fetched, http.StatusUnauthorized, "fetching an image with no session")
}
