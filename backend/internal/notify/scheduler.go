package notify

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// checkInterval is how often the scheduler looks for reminders that are due.
// Short next to a day, so that a restart or a failed delivery is made up for
// within the hour, and cheap because a reminder already sent is skipped by one
// query per channel.
const checkInterval = 15 * time.Minute

// Scheduler sends the reminders that are due.
//
// A reminder is due once a game's release is within the days an account asked
// for, and again on the day it comes out. Each is sent once per channel: the
// log of what went out is what makes checking often harmless.
type Scheduler struct {
	registry *Registry
	outbox   *repository.NotificationOutbox
	hour     int
}

// NewScheduler builds a scheduler that sends nothing before the given hour of
// the day, in the time zone of the times it is given.
func NewScheduler(db *gorm.DB, registry *Registry, hour int) *Scheduler {
	return &Scheduler{
		registry: registry,
		outbox:   repository.NewNotificationOutbox(db),
		hour:     hour,
	}
}

// Run sends reminders until ctx ends. It does nothing at all when the
// deployment offers no channel.
func (s *Scheduler) Run(ctx context.Context) {
	if len(s.registry.All()) == 0 {
		return
	}
	slog.Info("release reminders enabled", "channels", len(s.registry.All()), "from_hour", s.hour)

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		if err := s.Tick(ctx, time.Now()); err != nil && ctx.Err() == nil {
			slog.Error("could not send release reminders", "error", err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Tick sends whatever is due at now. A delivery that fails is logged and
// left for the next tick, and does not stop the others.
func (s *Scheduler) Tick(ctx context.Context, now time.Time) error {
	if now.Hour() < s.hour {
		return nil
	}
	// The same calendar day, as a date: that is what a release date is, and
	// what the database compares it with.
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	channels, err := s.outbox.EnabledChannels(ctx)
	if err != nil {
		return fmt.Errorf("listing the channels switched on: %w", err)
	}

	for _, saved := range channels {
		// An account can have settings for a channel the administrator has
		// since stopped offering. They are kept, and quiet.
		channel, ok := s.registry.Get(saved.Type)
		if !ok {
			continue
		}

		var settings map[string]string
		if err := json.Unmarshal([]byte(saved.Settings), &settings); err != nil {
			slog.Warn("skipping a channel whose settings are not readable",
				"user", saved.UserID, "channel", saved.Type, "error", err)
			continue
		}

		games, err := s.outbox.Pending(ctx, saved, today)
		if err != nil {
			return fmt.Errorf("finding what %s still has to announce to user %d: %w", saved.Type, saved.UserID, err)
		}

		for _, game := range games {
			kind, msg := compose(game, today)
			if err := channel.Send(ctx, settings, msg); err != nil {
				slog.Warn("could not send a release reminder",
					"user", saved.UserID, "channel", saved.Type, "game", game.ID, "error", err)
				continue
			}

			entry := &models.NotificationLog{
				UserID:      saved.UserID,
				GameID:      game.ID,
				ChannelType: saved.Type,
				Kind:        kind,
				ReleaseDate: game.ReleaseDate,
				SentAt:      time.Now().UTC(),
			}
			if err := s.outbox.MarkSent(ctx, entry); err != nil {
				return fmt.Errorf("recording a reminder for game %d: %w", game.ID, err)
			}
		}
	}
	return nil
}

// compose writes the reminder for a game on a given day, and says which kind
// it is.
func compose(game repository.UpcomingGame, today time.Time) (models.NotificationKind, Message) {
	days := int(game.ReleaseDate.Sub(today).Hours() / 24)

	switch {
	case days <= 0:
		return models.NotificationRelease, Message{Title: game.Title, Body: "Out today!"}
	case days == 1:
		return models.NotificationReminder, Message{
			Title: game.Title,
			Body:  "Comes out tomorrow, " + game.ReleaseDate.Format("Jan 2, 2006") + ".",
		}
	default:
		return models.NotificationReminder, Message{
			Title: game.Title,
			Body:  fmt.Sprintf("Comes out in %d days, %s.", days, game.ReleaseDate.Format("Jan 2, 2006")),
		}
	}
}

// TestMessage is what the "send a test" button delivers.
var TestMessage = Message{
	Title: "Gamelog",
	Body:  "This is a test. Reminders about upcoming releases will arrive here.",
}
