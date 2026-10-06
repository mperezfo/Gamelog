package handlers_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/config"
	"github.com/mperezfo/gamelog/internal/router"
	"github.com/mperezfo/gamelog/internal/testsupport"
)

// channelBody mirrors the fields of a channel the tests look at.
type channelBody struct {
	Type       string            `json:"type"`
	Enabled    bool              `json:"enabled"`
	DaysBefore int               `json:"days_before"`
	Settings   map[string]string `json:"settings"`
	Fields     []struct {
		Key      string `json:"key"`
		Required bool   `json:"required"`
	} `json:"fields"`
}

// newNotifyRouter builds a router that offers the ntfy channel through the
// given server, and signs in as an account.
func newNotifyRouter(t *testing.T, db *gorm.DB, ntfyURL, username string) http.Handler {
	t.Helper()

	cfg := config.Config{
		SessionLifetime: testSessionLifetime,
		ImagesDir:       os.TempDir(),
		NtfyURL:         ntfyURL,
	}
	return signedIn(t, router.New(cfg, db, newAuthService(db), "test"), db, username, false)
}

// fakeNtfyServer answers every request with status and counts them.
func fakeNtfyServer(t *testing.T, status int) (*httptest.Server, *atomic.Int32) {
	t.Helper()

	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		hits.Add(1)
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)
	return server, &hits
}

func TestNotificationChannelsAreEmptyWithoutAServer(t *testing.T) {
	handler := newNotifyRouter(t, testsupport.NewDatabase(t), "", "player")

	rec := request(t, handler, http.MethodGet, "/api/notifications/channels", nil)
	expectStatus(t, rec, http.StatusOK, "listing channels")

	var channels []channelBody
	decode(t, rec, &channels)
	if len(channels) != 0 {
		t.Errorf("listed %d channels on a deployment with no ntfy server, want none", len(channels))
	}

	rec = request(t, handler, http.MethodPut, "/api/notifications/channels/ntfy", map[string]any{
		"enabled": false, "days_before": 3, "settings": map[string]string{},
	})
	expectStatus(t, rec, http.StatusNotFound, "saving a channel the deployment does not offer")
}

func TestNotificationChannelStartsSwitchedOff(t *testing.T) {
	server, _ := fakeNtfyServer(t, http.StatusOK)
	handler := newNotifyRouter(t, testsupport.NewDatabase(t), server.URL, "player")

	rec := request(t, handler, http.MethodGet, "/api/notifications/channels", nil)
	expectStatus(t, rec, http.StatusOK, "listing channels")

	var channels []channelBody
	decode(t, rec, &channels)
	if len(channels) != 1 || channels[0].Type != "ntfy" {
		t.Fatalf("listed %+v, want exactly ntfy", channels)
	}
	got := channels[0]
	if got.Enabled || got.DaysBefore != 3 || len(got.Settings) != 0 {
		t.Errorf("an unsaved channel = %+v, want off, 3 days, no settings", got)
	}
	if len(got.Fields) != 1 || got.Fields[0].Key != "topic" || !got.Fields[0].Required {
		t.Errorf("fields = %+v, want a required topic", got.Fields)
	}
}

func TestSavingANotificationChannel(t *testing.T) {
	server, _ := fakeNtfyServer(t, http.StatusOK)
	handler := newNotifyRouter(t, testsupport.NewDatabase(t), server.URL, "player")

	rec := request(t, handler, http.MethodPut, "/api/notifications/channels/ntfy", map[string]any{
		"enabled": true, "days_before": 7, "settings": map[string]string{"topic": "my-games"},
	})
	expectStatus(t, rec, http.StatusOK, "saving")

	var saved channelBody
	decode(t, rec, &saved)
	if !saved.Enabled || saved.DaysBefore != 7 || saved.Settings["topic"] != "my-games" {
		t.Errorf("saved = %+v, want what was sent", saved)
	}

	rec = request(t, handler, http.MethodGet, "/api/notifications/channels", nil)
	var channels []channelBody
	decode(t, rec, &channels)
	if len(channels) != 1 || !channels[0].Enabled || channels[0].DaysBefore != 7 || channels[0].Settings["topic"] != "my-games" {
		t.Errorf("listed %+v after saving, want the saved values", channels)
	}

	rec = request(t, handler, http.MethodPut, "/api/notifications/channels/ntfy", map[string]any{
		"enabled": false, "days_before": 0, "settings": map[string]string{"topic": "my-games"},
	})
	expectStatus(t, rec, http.StatusOK, "saving again replaces what was there")
	decode(t, rec, &saved)
	if saved.Enabled || saved.DaysBefore != 0 {
		t.Errorf("saved again = %+v, want off and 0 days", saved)
	}
}

func TestSavingANotificationChannelValidates(t *testing.T) {
	server, _ := fakeNtfyServer(t, http.StatusOK)
	handler := newNotifyRouter(t, testsupport.NewDatabase(t), server.URL, "player")

	tests := []struct {
		name string
		body map[string]any
		want int
	}{
		{"switched on with no topic", map[string]any{"enabled": true, "days_before": 3, "settings": map[string]string{}}, http.StatusUnprocessableEntity},
		{"badly formed topic", map[string]any{"enabled": true, "days_before": 3, "settings": map[string]string{"topic": "a b"}}, http.StatusUnprocessableEntity},
		{"a setting the channel does not have", map[string]any{"enabled": false, "days_before": 3, "settings": map[string]string{"url": "http://internal"}}, http.StatusUnprocessableEntity},
		{"too many days", map[string]any{"enabled": false, "days_before": 31, "settings": map[string]string{}}, http.StatusUnprocessableEntity},
		{"negative days", map[string]any{"enabled": false, "days_before": -1, "settings": map[string]string{}}, http.StatusUnprocessableEntity},
		{"a draft with no topic, switched off", map[string]any{"enabled": false, "days_before": 3, "settings": map[string]string{}}, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := request(t, handler, http.MethodPut, "/api/notifications/channels/ntfy", tt.body)
			expectStatus(t, rec, tt.want, tt.name)
		})
	}
}

func TestNotificationChannelsBelongToTheirAccount(t *testing.T) {
	server, _ := fakeNtfyServer(t, http.StatusOK)
	db := testsupport.NewDatabase(t)
	first := newNotifyRouter(t, db, server.URL, "first")
	second := newNotifyRouter(t, db, server.URL, "second")

	rec := request(t, first, http.MethodPut, "/api/notifications/channels/ntfy", map[string]any{
		"enabled": true, "days_before": 5, "settings": map[string]string{"topic": "first-topic"},
	})
	expectStatus(t, rec, http.StatusOK, "the first account saving")

	rec = request(t, second, http.MethodGet, "/api/notifications/channels", nil)
	var channels []channelBody
	decode(t, rec, &channels)
	if len(channels) != 1 || channels[0].Enabled || channels[0].Settings["topic"] != "" {
		t.Errorf("the second account sees %+v, want a channel of its own, untouched", channels)
	}
}

func TestSendingATestNotification(t *testing.T) {
	server, hits := fakeNtfyServer(t, http.StatusOK)
	handler := newNotifyRouter(t, testsupport.NewDatabase(t), server.URL, "player")

	rec := request(t, handler, http.MethodPost, "/api/notifications/channels/ntfy/test", nil)
	expectStatus(t, rec, http.StatusUnprocessableEntity, "testing before anything is saved")
	if hits.Load() != 0 {
		t.Fatalf("the server was called %d times before there was anything to send to", hits.Load())
	}

	request(t, handler, http.MethodPut, "/api/notifications/channels/ntfy", map[string]any{
		"enabled": false, "days_before": 3, "settings": map[string]string{"topic": "my-games"},
	})
	rec = request(t, handler, http.MethodPost, "/api/notifications/channels/ntfy/test", nil)
	expectStatus(t, rec, http.StatusNoContent, "testing with saved settings, even with the channel off")
	if hits.Load() != 1 {
		t.Errorf("the server was called %d times, want 1", hits.Load())
	}

	rec = request(t, handler, http.MethodPost, "/api/notifications/channels/nope/test", nil)
	expectStatus(t, rec, http.StatusNotFound, "testing a channel that does not exist")
}

func TestATestNotificationThatCannotBeDeliveredIsABadGateway(t *testing.T) {
	server, _ := fakeNtfyServer(t, http.StatusInternalServerError)
	handler := newNotifyRouter(t, testsupport.NewDatabase(t), server.URL, "player")

	request(t, handler, http.MethodPut, "/api/notifications/channels/ntfy", map[string]any{
		"enabled": true, "days_before": 3, "settings": map[string]string{"topic": "my-games"},
	})
	rec := request(t, handler, http.MethodPost, "/api/notifications/channels/ntfy/test", nil)
	expectStatus(t, rec, http.StatusBadGateway, "the server failing")

	if containsAny(rec.Body.String(), server.URL, "127.0.0.1") {
		t.Errorf("the error leaks the server's address: %s", rec.Body.String())
	}
}
