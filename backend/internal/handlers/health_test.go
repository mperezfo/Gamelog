package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mperezfo/gamelog/internal/testsupport"
)

func TestHealth(t *testing.T) {
	db := testsupport.NewDatabase(t)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	newBareRouter(db, false).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body struct {
		Status   string `json:"status"`
		Service  string `json:"service"`
		Database string `json:"database"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status = %q, want %q", body.Status, "ok")
	}
	if body.Service != "gamelog" {
		t.Errorf("service = %q, want %q", body.Service, "gamelog")
	}
	if body.Database != "ok" {
		t.Errorf("database = %q, want %q", body.Database, "ok")
	}
}

func TestHealthReportsUnreachableDatabase(t *testing.T) {
	db := testsupport.NewDatabase(t)

	// Closing the pool is the cheapest way to simulate a database that has
	// gone away without stopping the container.
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtaining the connection pool: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("closing the connection pool: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	newBareRouter(db, false).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
}
