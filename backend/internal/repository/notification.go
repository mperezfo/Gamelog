package repository

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/mperezfo/gamelog/internal/models"
)

// NotificationRepository is the data access for one account's notification
// channels.
type NotificationRepository struct {
	db     *gorm.DB
	userID uint64
}

// NewNotificationRepository builds the repository for one account. Like the
// game repository, the owner is fixed at construction so that no call can
// reach another account's settings by forgetting an argument.
func NewNotificationRepository(db *gorm.DB, userID uint64) *NotificationRepository {
	return &NotificationRepository{db: db, userID: userID}
}

// List returns every channel the account has saved.
func (r *NotificationRepository) List(ctx context.Context) ([]models.NotificationChannel, error) {
	var channels []models.NotificationChannel
	err := r.db.WithContext(ctx).Where("user_id = ?", r.userID).Find(&channels).Error
	return channels, translate(err)
}

// Find returns the account's channel of the given type, or ErrNotFound when
// it has never saved one.
func (r *NotificationRepository) Find(ctx context.Context, channelType string) (*models.NotificationChannel, error) {
	var channel models.NotificationChannel
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND type = ?", r.userID, channelType).
		First(&channel).Error
	if err != nil {
		return nil, translate(err)
	}
	return &channel, nil
}

// Save creates the channel or replaces what it held.
func (r *NotificationRepository) Save(ctx context.Context, channel *models.NotificationChannel) error {
	channel.UserID = r.userID
	err := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "type"}},
		DoUpdates: clause.AssignmentColumns([]string{"enabled", "days_before", "settings", "updated_at"}),
	}).Create(channel).Error
	return translate(err)
}

// UpcomingGame is a game about to come out, as far as a reminder needs to know
// about it.
type UpcomingGame struct {
	ID          uint64
	Title       string
	ReleaseDate time.Time
}

// NotificationOutbox is the scheduler's view of notifications: it reads across
// every account, which is why it is a separate type from the per-account
// repository and not a method on it.
type NotificationOutbox struct {
	db *gorm.DB
}

// NewNotificationOutbox builds the outbox.
func NewNotificationOutbox(db *gorm.DB) *NotificationOutbox {
	return &NotificationOutbox{db: db}
}

// EnabledChannels returns every channel an account has switched on.
func (o *NotificationOutbox) EnabledChannels(ctx context.Context) ([]models.NotificationChannel, error) {
	var channels []models.NotificationChannel
	err := o.db.WithContext(ctx).Where("enabled = ?", true).Find(&channels).Error
	return channels, translate(err)
}

// Pending returns the games a channel still has to be told about on the given
// day: those coming out between today and today plus the channel's
// DaysBefore, minus the ones whose reminder of the right kind has already
// gone out.
//
// Games already played are left out: a release date on one is a record of
// when it came out, not something to wait for.
func (o *NotificationOutbox) Pending(ctx context.Context, channel models.NotificationChannel, today time.Time) ([]UpcomingGame, error) {
	var games []UpcomingGame
	err := o.db.WithContext(ctx).
		Table("games").
		Select("games.id, games.title, games.release_date").
		Where("games.user_id = ?", channel.UserID).
		Where("games.status <> ?", models.StatusPlayed).
		Where("games.release_date BETWEEN ? AND ?", today, today.AddDate(0, 0, channel.DaysBefore)).
		Where(`NOT EXISTS (
			SELECT 1 FROM notification_log l
			WHERE l.user_id = games.user_id AND l.game_id = games.id
			  AND l.channel_type = ? AND l.release_date = games.release_date
			  AND l.kind = IF(games.release_date = ?, ?, ?)
		)`, channel.Type, today, models.NotificationRelease, models.NotificationReminder).
		Order("games.release_date, games.title").
		Scan(&games).Error
	return games, translate(err)
}

// MarkSent records that a reminder was delivered. Recording one twice is not
// an error.
func (o *NotificationOutbox) MarkSent(ctx context.Context, entry *models.NotificationLog) error {
	err := o.db.WithContext(ctx).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(entry).Error
	return translate(err)
}
