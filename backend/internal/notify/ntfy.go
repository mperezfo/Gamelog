package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
)

// ntfyType is how the channel is stored and addressed.
const ntfyType = "ntfy"

// ntfyTopic is what ntfy accepts as a topic name. Matching it is what keeps a
// topic from carrying anything else to the server.
var ntfyTopic = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ntfy delivers messages through an ntfy server, which pushes them to the
// phones and browsers subscribed to a topic.
//
// The server is the administrator's, fixed by configuration. The only thing an
// account chooses is the topic, so nobody can make this process call an
// address of their own.
type ntfy struct {
	baseURL string
	token   string
	client  *http.Client
}

func newNtfy(baseURL, token string, client *http.Client) *ntfy {
	return &ntfy{baseURL: baseURL, token: token, client: client}
}

func (*ntfy) Type() string { return ntfyType }

func (*ntfy) Name() string { return "ntfy" }

func (*ntfy) Description() string {
	return "Push notifications to your phone or browser through ntfy. Subscribe to your topic in the ntfy app to receive them."
}

func (*ntfy) Fields() []Field {
	return []Field{{
		Key:         "topic",
		Label:       "Topic",
		Placeholder: "gamelog-martin",
		Hint:        "Letters, digits, dashes and underscores. Anybody who knows the topic can read it, so make it hard to guess.",
		Required:    true,
	}}
}

func (*ntfy) Check(settings map[string]string) error {
	topic, ok := settings["topic"]
	if ok && topic != "" && !ntfyTopic.MatchString(topic) {
		return fmt.Errorf("%w: a topic is up to 64 letters, digits, dashes or underscores", ErrInvalidSettings)
	}
	return nil
}

// ntfyPublish is the body of a publish request. Sending JSON rather than
// headers is what lets a title carry any character.
type ntfyPublish struct {
	Topic   string   `json:"topic"`
	Title   string   `json:"title"`
	Message string   `json:"message"`
	Tags    []string `json:"tags"`
}

func (n *ntfy) Send(ctx context.Context, settings map[string]string, msg Message) error {
	topic := settings["topic"]
	if !ntfyTopic.MatchString(topic) {
		return fmt.Errorf("%w: there is no valid topic", ErrInvalidSettings)
	}

	body, err := json.Marshal(ntfyPublish{
		Topic:   topic,
		Title:   msg.Title,
		Message: msg.Body,
		Tags:    []string{"video_game"},
	})
	if err != nil {
		return fmt.Errorf("encoding the ntfy message: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, n.baseURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building the ntfy request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if n.token != "" {
		req.Header.Set("Authorization", "Bearer "+n.token)
	}

	resp, err := n.client.Do(req)
	if err != nil {
		return fmt.Errorf("reaching the ntfy server: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("the ntfy server answered %s", resp.Status)
	}
	return nil
}
