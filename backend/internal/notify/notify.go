// Package notify tells accounts about the games that are about to come out.
//
// A Channel is one way of reaching somebody, such as an ntfy topic. What a
// deployment offers is decided by its administrator through configuration;
// what each account does with it, by the account. The Scheduler is what puts
// the two together once a day.
package notify

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// Message is what a channel delivers.
type Message struct {
	Title string
	Body  string
}

// Field describes one setting a channel asks an account for, which is what
// lets the application draw the form without knowing any channel by name.
type Field struct {
	Key         string `json:"key" doc:"Name of the setting, as it appears in the settings object." example:"topic"`
	Label       string `json:"label" doc:"What to call the setting in a form." example:"Topic"`
	Placeholder string `json:"placeholder,omitempty" doc:"An example value to show in the empty input."`
	Hint        string `json:"hint,omitempty" doc:"A sentence explaining what to put in it."`
	Required    bool   `json:"required" doc:"Whether the channel cannot be switched on without it."`
}

// maxSettingLength bounds every setting. Nothing a channel asks for needs more.
const maxSettingLength = 255

// Channel is one way of delivering a Message.
type Channel interface {
	// Type identifies the channel. It is stored with every account's settings,
	// so it never changes.
	Type() string
	// Name is what the application calls the channel.
	Name() string
	// Description is a sentence on what the channel is.
	Description() string
	// Fields lists the settings the channel asks an account for.
	Fields() []Field
	// Check validates the format of the settings that are present. It is not
	// asked about the ones that are missing: Validate does that.
	Check(settings map[string]string) error
	// Send delivers a message to the account whose settings these are.
	Send(ctx context.Context, settings map[string]string, msg Message) error
}

// ErrInvalidSettings is returned for settings a channel does not accept. Its
// message is written for the person who typed them.
var ErrInvalidSettings = errors.New("invalid settings")

// Validate checks settings against what a channel asks for. With complete set
// every required field must be filled in, which is what switching a channel on
// demands; without it, a half-finished form can still be saved.
func Validate(channel Channel, settings map[string]string, complete bool) error {
	known := map[string]Field{}
	for _, field := range channel.Fields() {
		known[field.Key] = field
	}

	for key, value := range settings {
		if _, ok := known[key]; !ok {
			return fmt.Errorf("%w: %q is not a setting of %s", ErrInvalidSettings, key, channel.Name())
		}
		if len(value) > maxSettingLength {
			return fmt.Errorf("%w: %s is longer than %d characters", ErrInvalidSettings, known[key].Label, maxSettingLength)
		}
	}

	if complete {
		for _, field := range channel.Fields() {
			if field.Required && settings[field.Key] == "" {
				return fmt.Errorf("%w: %s is required", ErrInvalidSettings, field.Label)
			}
		}
	}

	return channel.Check(settings)
}

// Options is what the channels need from the deployment's configuration.
type Options struct {
	// NtfyURL and NtfyToken configure the ntfy channel, which is only offered
	// when NtfyURL is set.
	NtfyURL   string
	NtfyToken string
	// Client sends the requests. Nil uses one with a timeout.
	Client *http.Client
}

// Registry is the set of channels a deployment offers.
type Registry struct {
	channels []Channel
}

// NewRegistry builds the channels the options enable, in the order they are
// shown.
func NewRegistry(options Options) *Registry {
	client := options.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	registry := &Registry{}
	if options.NtfyURL != "" {
		registry.channels = append(registry.channels, newNtfy(options.NtfyURL, options.NtfyToken, client))
	}
	return registry
}

// All returns the channels on offer.
func (r *Registry) All() []Channel {
	return r.channels
}

// Get returns the channel of the given type, if the deployment offers it.
func (r *Registry) Get(channelType string) (Channel, bool) {
	for _, channel := range r.channels {
		if channel.Type() == channelType {
			return channel, true
		}
	}
	return nil, false
}
