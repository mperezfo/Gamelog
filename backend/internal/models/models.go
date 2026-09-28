// Package models holds the entities described in the spec.
//
// The database schema is owned by the migrations in backend/migrations, not by
// these structs: GORM's AutoMigrate is deliberately disabled. The tags below
// therefore only carry what GORM needs at runtime — primary keys, column names
// and relations — and never duplicate the DDL, so there is a single source of
// truth for the schema.
package models

import "time"

// Game is the main entity.
type Game struct {
	ID uint64 `gorm:"column:id;primaryKey" json:"id"`
	// UserID is the owner. It is not part of the JSON because a caller only
	// ever sees their own games: the repository scopes every query to the
	// session's user, so the field would say the same thing on every record.
	// It is a pointer because the column is nullable for games that predate
	// authentication; see migration 00002.
	UserID *uint64 `gorm:"column:user_id" json:"-"`

	Title string `gorm:"column:title" json:"title"`
	// Slug is derived from Title and kept in sync with it — see internal/slug
	// and GameRepository.assignSlug. It is never set directly by a caller.
	Slug   string   `gorm:"column:slug" json:"slug"`
	Status Status   `gorm:"column:status" json:"status"`
	Score  *float64 `gorm:"column:score" json:"score"`

	// Position breaks a tie within a status column on the dashboard's board:
	// the primary order there is logged_date descending (client-side, see the
	// frontend's lib/gameSort.ts), so this only ever matters among games
	// sharing a date or with none. See migration 00004.
	Position float64 `gorm:"column:position" json:"position"`

	// Tagline is the equivalent of the "Four words" Notion field.
	Tagline *string `gorm:"column:tagline" json:"tagline"`
	Notes   *string `gorm:"column:notes" json:"notes"`

	CoverImageURL *string `gorm:"column:cover_image_url" json:"cover_image_url"`
	// CoverFocalX and CoverFocalY are where a portrait crop of the cover
	// should be centred, as a fraction of the image's size. Null means
	// centre, today's default. See migration 00008.
	CoverFocalX *float64 `gorm:"column:cover_focal_x" json:"cover_focal_x"`
	CoverFocalY *float64 `gorm:"column:cover_focal_y" json:"cover_focal_y"`
	// CoverZoom is how far to zoom in on the portrait crop, anchored at
	// CoverFocalX/Y. Null (or 1) means no zoom, today's default. See
	// migration 00009.
	CoverZoom *float64 `gorm:"column:cover_zoom" json:"cover_zoom"`

	ReleaseDate *time.Time `gorm:"column:release_date" json:"release_date"`
	// LoggedDate is the equivalent of the "Date" Notion field: when the game
	// was started, logged or finished.
	LoggedDate *time.Time `gorm:"column:logged_date" json:"logged_date"`

	PlatformID *uint64   `gorm:"column:platform_id" json:"platform_id"`
	Platform   *Platform `gorm:"foreignKey:PlatformID" json:"platform,omitempty"`

	Genres     []Genre     `gorm:"many2many:game_genres" json:"genres,omitempty"`
	Developers []Developer `gorm:"many2many:game_developers" json:"developers,omitempty"`
	Publishers []Publisher `gorm:"many2many:game_publishers" json:"publishers,omitempty"`

	CreatedAt time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at" json:"updated_at"`
}

// Genre is a game genre.
type Genre struct {
	ID uint64 `gorm:"column:id;primaryKey" json:"id"`
	// UserID is the owner: like a game, this is one account's own record, not
	// shared with anybody else. Not part of the JSON for the same reason as
	// Game.UserID — a caller only ever sees their own. See migration 00013.
	UserID uint64 `gorm:"column:user_id" json:"-"`
	Name   string `gorm:"column:name" json:"name"`
	// Slug is derived from Name and kept in sync with it — see internal/slug
	// and LookupRepository.assignSlug. It is never set directly by a caller,
	// and it is the only one of the two other code should ever put in a URL:
	// the id is purely internal. See migration 00011.
	Slug string  `gorm:"column:slug" json:"slug"`
	Icon *string `gorm:"column:icon" json:"icon"`
}

// Developer is a game developer.
type Developer struct {
	ID     uint64  `gorm:"column:id;primaryKey" json:"id"`
	UserID uint64  `gorm:"column:user_id" json:"-"`
	Name   string  `gorm:"column:name" json:"name"`
	Slug   string  `gorm:"column:slug" json:"slug"`
	Icon   *string `gorm:"column:icon" json:"icon"`
}

// Publisher is a game publisher.
type Publisher struct {
	ID     uint64  `gorm:"column:id;primaryKey" json:"id"`
	UserID uint64  `gorm:"column:user_id" json:"-"`
	Name   string  `gorm:"column:name" json:"name"`
	Slug   string  `gorm:"column:slug" json:"slug"`
	Icon   *string `gorm:"column:icon" json:"icon"`
}

// Platform is a system a game was played.
type Platform struct {
	ID     uint64  `gorm:"column:id;primaryKey" json:"id"`
	UserID uint64  `gorm:"column:user_id" json:"-"`
	Name   string  `gorm:"column:name" json:"name"`
	Slug   string  `gorm:"column:slug" json:"slug"`
	Icon   *string `gorm:"column:icon" json:"icon"`
	// Color is a hex code ("#3b82f6") shown wherever a game's platform is.
	// Platform only: see migration 00003.
	Color *string `gorm:"column:color" json:"color"`
}
