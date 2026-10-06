package notify_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mperezfo/gamelog/internal/notify"
)

// published is what a fake ntfy server received.
type published struct {
	Topic   string   `json:"topic"`
	Title   string   `json:"title"`
	Message string   `json:"message"`
	Tags    []string `json:"tags"`
}

// fakeNtfy starts a server that records every publish request it gets and
// answers with status.
func fakeNtfy(t *testing.T, status int) (url string, received *[]published, auth *[]string) {
	t.Helper()

	var got []published
	var headers []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var p published
		if err := json.Unmarshal(body, &p); err != nil {
			t.Errorf("the request body is not JSON: %v; body: %s", err, body)
		}
		got = append(got, p)
		headers = append(headers, r.Header.Get("Authorization"))
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)
	return server.URL, &got, &headers
}

func TestNtfySendsTheMessageToTheTopic(t *testing.T) {
	url, received, auth := fakeNtfy(t, http.StatusOK)
	channel, _ := notify.NewRegistry(notify.Options{NtfyURL: url, NtfyToken: "secret"}).Get("ntfy")

	err := channel.Send(context.Background(), map[string]string{"topic": "gamelog-test"},
		notify.Message{Title: "Hollow Knight: Silksong", Body: "Out today!"})
	if err != nil {
		t.Fatalf("sending: %v", err)
	}

	if len(*received) != 1 {
		t.Fatalf("the server got %d requests, want 1", len(*received))
	}
	got := (*received)[0]
	if got.Topic != "gamelog-test" || got.Title != "Hollow Knight: Silksong" || got.Message != "Out today!" {
		t.Errorf("published %+v, want the topic, title and message that were sent", got)
	}
	if (*auth)[0] != "Bearer secret" {
		t.Errorf("Authorization = %q, want the configured token as a bearer", (*auth)[0])
	}
}

func TestNtfySendsNoAuthorizationWithoutAToken(t *testing.T) {
	url, _, auth := fakeNtfy(t, http.StatusOK)
	channel, _ := notify.NewRegistry(notify.Options{NtfyURL: url}).Get("ntfy")

	if err := channel.Send(context.Background(), map[string]string{"topic": "t"}, notify.Message{}); err != nil {
		t.Fatalf("sending: %v", err)
	}
	if (*auth)[0] != "" {
		t.Errorf("Authorization = %q, want none", (*auth)[0])
	}
}

func TestNtfyReportsAServerError(t *testing.T) {
	url, _, _ := fakeNtfy(t, http.StatusUnauthorized)
	channel, _ := notify.NewRegistry(notify.Options{NtfyURL: url}).Get("ntfy")

	err := channel.Send(context.Background(), map[string]string{"topic": "t"}, notify.Message{})
	if err == nil {
		t.Fatal("sending to a server that answers 401 succeeded")
	}
}

func TestNtfyRefusesATopicThatIsNotOne(t *testing.T) {
	url, received, _ := fakeNtfy(t, http.StatusOK)
	channel, _ := notify.NewRegistry(notify.Options{NtfyURL: url}).Get("ntfy")

	for _, topic := range []string{"", "has space", "a/b", "../x", "café", string(make([]byte, 65))} {
		err := channel.Send(context.Background(), map[string]string{"topic": topic}, notify.Message{})
		if !errors.Is(err, notify.ErrInvalidSettings) {
			t.Errorf("topic %q: err = %v, want ErrInvalidSettings", topic, err)
		}
	}
	if len(*received) != 0 {
		t.Errorf("the server got %d requests for topics that are not valid, want none", len(*received))
	}
}

func TestRegistryOffersNothingWithoutAServer(t *testing.T) {
	registry := notify.NewRegistry(notify.Options{})
	if len(registry.All()) != 0 {
		t.Errorf("an unconfigured registry offers %d channels, want none", len(registry.All()))
	}
	if _, ok := registry.Get("ntfy"); ok {
		t.Error("ntfy is offered without a server to send through")
	}
}

func TestValidate(t *testing.T) {
	channel, _ := notify.NewRegistry(notify.Options{NtfyURL: "http://ntfy.invalid"}).Get("ntfy")

	tests := []struct {
		name     string
		settings map[string]string
		complete bool
		wantErr  bool
	}{
		{"complete and valid", map[string]string{"topic": "my-topic"}, true, false},
		{"missing a required field when complete", map[string]string{}, true, true},
		{"missing a required field while a draft", map[string]string{}, false, false},
		{"unknown setting", map[string]string{"topic": "t", "server": "http://evil"}, false, true},
		{"badly formed topic even as a draft", map[string]string{"topic": "no spaces"}, false, true},
		{"too long", map[string]string{"topic": string(make([]byte, 300))}, false, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := notify.Validate(channel, tt.settings, tt.complete)
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate = %v, want error: %v", err, tt.wantErr)
			}
			if err != nil && !errors.Is(err, notify.ErrInvalidSettings) {
				t.Errorf("error %v does not wrap ErrInvalidSettings", err)
			}
		})
	}
}
