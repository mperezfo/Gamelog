package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/notify"
	"github.com/mperezfo/gamelog/internal/repository"
)

// notificationsTag groups the operations about release reminders.
const notificationsTag = "Notifications"

// defaultDaysBefore is how far ahead of a release an account is reminded until
// it says otherwise.
const defaultDaysBefore = 3

// channelView is a channel the deployment offers, together with what the
// account has set up for it.
type channelView struct {
	Type        string         `json:"type" doc:"Identifies the channel." example:"ntfy"`
	Name        string         `json:"name" doc:"What to call the channel." example:"ntfy"`
	Description string         `json:"description" doc:"A sentence on what the channel is."`
	Fields      []notify.Field `json:"fields" doc:"The settings the channel asks for."`

	Enabled    bool              `json:"enabled" doc:"Whether reminders are sent through this channel."`
	DaysBefore int               `json:"days_before" minimum:"0" maximum:"30" doc:"How many days ahead of a release the reminder is sent. 0 means only on the day it comes out."`
	Settings   map[string]string `json:"settings" doc:"The account's values for the channel's fields."`
}

type channelListOutput struct {
	Body []channelView
}

type channelOutput struct {
	Body channelView
}

type channelTypeInput struct {
	Type string `path:"type" doc:"Type of the channel." example:"ntfy"`
}

type updateChannelInput struct {
	Type string `path:"type" doc:"Type of the channel." example:"ntfy"`
	Body struct {
		Enabled    bool              `json:"enabled" doc:"Whether to send reminders through this channel. Needs every required setting to be filled in."`
		DaysBefore int               `json:"days_before" minimum:"0" maximum:"30" doc:"How many days ahead of a release to send the reminder. 0 means only on the day it comes out."`
		Settings   map[string]string `json:"settings" doc:"Values for the channel's fields."`
	}
}

// registerNotifications registers the operations an account uses to set up
// its release reminders.
//
// Only the channels the deployment offers are visible here: one the
// administrator has not configured is a 404, as if it did not exist, because
// as far as this deployment goes it does not.
func registerNotifications(api huma.API, db *gorm.DB, registry *notify.Registry) {
	huma.Register(api, huma.Operation{
		OperationID: "list-notification-channels",
		Method:      http.MethodGet,
		Path:        "/api/notifications/channels",
		Summary:     "List notification channels",
		Description: "Returns every channel this deployment offers for release reminders, " +
			"each with the settings it asks for and what this account has set up. A channel " +
			"the account has never saved comes back switched off, with empty settings.",
		Tags:   []string{notificationsTag},
		Errors: []int{http.StatusUnauthorized},
	}, func(ctx context.Context, _ *struct{}) (*channelListOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		saved, err := repository.NewNotificationRepository(db, user.ID).List(ctx)
		if err != nil {
			return nil, apiError(err, "no such channel")
		}
		byType := make(map[string]models.NotificationChannel, len(saved))
		for _, channel := range saved {
			byType[channel.Type] = channel
		}

		views := make([]channelView, 0, len(registry.All()))
		for _, channel := range registry.All() {
			view, err := viewOf(channel, byType[channel.Type()])
			if err != nil {
				return nil, apiError(err, "no such channel")
			}
			views = append(views, view)
		}
		return &channelListOutput{Body: views}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-notification-channel",
		Method:      http.MethodPut,
		Path:        "/api/notifications/channels/{type}",
		Summary:     "Set up a notification channel",
		Description: "Saves how this account uses a channel: whether it is on, how many days " +
			"ahead of a release it is reminded, and the channel's own settings. Switching a " +
			"channel on needs every required setting to be filled in; a channel left off can " +
			"be saved half-finished.",
		Tags:   []string{notificationsTag},
		Errors: []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *updateChannelInput) (*channelOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}
		channel, ok := registry.Get(input.Type)
		if !ok {
			return nil, huma.Error404NotFound("this deployment does not offer that channel")
		}

		settings := input.Body.Settings
		if settings == nil {
			settings = map[string]string{}
		}
		if err := notify.Validate(channel, settings, input.Body.Enabled); err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}

		encoded, err := json.Marshal(settings)
		if err != nil {
			return nil, apiError(err, "no such channel")
		}

		saved := &models.NotificationChannel{
			Type:       channel.Type(),
			Enabled:    input.Body.Enabled,
			DaysBefore: input.Body.DaysBefore,
			Settings:   string(encoded),
		}
		if err := repository.NewNotificationRepository(db, user.ID).Save(ctx, saved); err != nil {
			return nil, apiError(err, "no such channel")
		}

		view, err := viewOf(channel, *saved)
		if err != nil {
			return nil, apiError(err, "no such channel")
		}
		return &channelOutput{Body: view}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "test-notification-channel",
		Method:      http.MethodPost,
		Path:        "/api/notifications/channels/{type}/test",
		Summary:     "Send a test notification",
		Description: "Sends a message through the channel with the settings this account has " +
			"saved, so that a typo shows up now rather than on the day a game comes out. The " +
			"channel does not have to be switched on.",
		Tags:          []string{notificationsTag},
		DefaultStatus: http.StatusNoContent,
		Errors: []int{
			http.StatusUnauthorized, http.StatusNotFound,
			http.StatusUnprocessableEntity, http.StatusBadGateway,
		},
	}, func(ctx context.Context, input *channelTypeInput) (*struct{}, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}
		channel, ok := registry.Get(input.Type)
		if !ok {
			return nil, huma.Error404NotFound("this deployment does not offer that channel")
		}

		saved, err := repository.NewNotificationRepository(db, user.ID).Find(ctx, channel.Type())
		if errors.Is(err, repository.ErrNotFound) {
			return nil, huma.Error422UnprocessableEntity("save the channel's settings before sending a test")
		}
		if err != nil {
			return nil, apiError(err, "no such channel")
		}

		var settings map[string]string
		if err := json.Unmarshal([]byte(saved.Settings), &settings); err != nil {
			return nil, apiError(err, "no such channel")
		}
		if err := notify.Validate(channel, settings, true); err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}

		if err := channel.Send(ctx, settings, notify.TestMessage); err != nil {
			// The cause can name the server's address, which is the
			// administrator's business, so it goes to the log and the account
			// is told only that the delivery failed.
			slog.Warn("a test notification failed", "user", user.ID, "channel", channel.Type(), "error", err)
			return nil, huma.Error502BadGateway("the notification could not be delivered, check the settings and try again")
		}
		return nil, nil
	})
}

// viewOf joins a channel with what an account saved for it, if anything.
func viewOf(channel notify.Channel, saved models.NotificationChannel) (channelView, error) {
	view := channelView{
		Type:        channel.Type(),
		Name:        channel.Name(),
		Description: channel.Description(),
		Fields:      channel.Fields(),
		DaysBefore:  defaultDaysBefore,
		Settings:    map[string]string{},
	}

	if saved.Type == "" {
		return view, nil
	}
	view.Enabled = saved.Enabled
	view.DaysBefore = saved.DaysBefore
	if err := json.Unmarshal([]byte(saved.Settings), &view.Settings); err != nil {
		return channelView{}, err
	}
	if view.Settings == nil {
		view.Settings = map[string]string{}
	}
	return view, nil
}
