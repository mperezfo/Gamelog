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

func TestClientAddressTrustsOnlyTheBundledProxy(t *testing.T) {
	var seen string
	handler := clientAddress(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { seen = r.RemoteAddr }))

	for _, tc := range []struct {
		name, remote, realIP, want string
	}{
		{"from the bundled Caddy", "127.0.0.1:51234", "203.0.113.7", "203.0.113.7"},
		{"from the bundled Caddy over IPv6", "[::1]:51234", "2001:db8::7", "2001:db8::7"},
		{"from the bundled Caddy without a header", "127.0.0.1:51234", "", "127.0.0.1:51234"},
		{"from the bundled Caddy with nonsense", "127.0.0.1:51234", "not an address", "127.0.0.1:51234"},
		{"from anyone else", "192.0.2.1:4000", "203.0.113.7", "192.0.2.1:4000"},
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		req.RemoteAddr = tc.remote
		if tc.realIP != "" {
			req.Header.Set("X-Real-IP", tc.realIP)
		}
		handler.ServeHTTP(httptest.NewRecorder(), req)
		if seen != tc.want {
			t.Errorf("%s: RemoteAddr = %q, want %q", tc.name, seen, tc.want)
		}
	}
}
