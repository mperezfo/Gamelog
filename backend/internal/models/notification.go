package models

import "time"

// NotificationChannel is how one account has set up one way of being told
// about upcoming releases. There is one per account and channel type, and it
// only exists once the account has saved it.
type NotificationChannel struct {
	UserID uint64 `gorm:"column:user_id;primaryKey"`
	// Type names the channel, such as "ntfy". It is what the code registers
	// the channel under, not something an account chooses.
	Type    string `gorm:"column:type;primaryKey"`
	Enabled bool   `gorm:"column:enabled"`
	// DaysBefore is how many days ahead of a release the reminder is sent. Zero
	// means no advance reminder, only the one on the day.
	DaysBefore int `gorm:"column:days_before"`
	// Settings is a JSON object of strings holding what the channel needs to
	// reach this account. It stays a string at this level: its shape belongs
	// to the channel, which validates it before it is saved.
	Settings string `gorm:"column:settings"`

	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

// NotificationKind says which of the two reminders about a game is being sent.
type NotificationKind string

const (
	// NotificationReminder is sent ahead of a release, once it is within the
	// channel's DaysBefore.
	NotificationReminder NotificationKind = "reminder"
	// NotificationRelease is sent on the day the game comes out.
	NotificationRelease NotificationKind = "release"
)

// NotificationLog is a reminder that was delivered.
type NotificationLog struct {
	UserID      uint64           `gorm:"column:user_id;primaryKey"`
	GameID      uint64           `gorm:"column:game_id;primaryKey"`
	ChannelType string           `gorm:"column:channel_type;primaryKey"`
	Kind        NotificationKind `gorm:"column:kind;primaryKey"`
	// ReleaseDate is the date the reminder was about. A game whose date moves
	// is announced again for the new one.
	ReleaseDate time.Time `gorm:"column:release_date;primaryKey"`
	SentAt      time.Time `gorm:"column:sent_at"`
}

// TableName is notification_log rather than the pluralised default, since the
// table is a log and not a collection of entities.
func (NotificationLog) TableName() string { return "notification_log" }
