package router

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestRequestTimeoutLeavesLibraryLoadsRunning: restoring a backup and
// importing a library run for as long as they need, and nothing else does.
func TestRequestTimeoutLeavesLibraryLoadsRunning(t *testing.T) {
	// Answers once it has worked for longer than the timeout below, unless
	// its context is cancelled first.
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(100 * time.Millisecond):
			w.WriteHeader(http.StatusOK)
		}
	})
	handler := requestTimeout(10 * time.Millisecond)(slow)

	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{http.MethodPost, "/api/backup", http.StatusOK},
		{http.MethodPost, "/api/import", http.StatusOK},
		{http.MethodGet, "/api/backup", http.StatusGatewayTimeout},
		{http.MethodPost, "/api/games", http.StatusGatewayTimeout},
	} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
		if rec.Code != tc.want {
			t.Errorf("%s %s: status = %d, want %d", tc.method, tc.path, rec.Code, tc.want)
		}
	}
}
