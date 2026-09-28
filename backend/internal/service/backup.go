package service

import (
	"errors"
	"strings"
)

// AccountEntry is the account section of a backup: the fields of models.User
// a full export carries alongside the library, so that restoring one
// recreates the account as it was, not just its games.
//
// It has no business in the plain JSON format GET /api/export writes and
// POST /api/import reads — that format is meant to be read by hand, by a
// spreadsheet, or by another tracker, and a password hash is none of those
// things' concern. AccountEntry only ever travels inside a backup .zip; see
// handlers.registerPortability.
type AccountEntry struct {
	Name      string  `json:"name" doc:"Name shown in the application."`
	AvatarURL *string `json:"avatar_url" doc:"URL of the profile picture."`
	// PasswordHash is bcrypt output, carried as-is: a backup restores the
	// account exactly as it was, not a new password nobody chose. Restoring
	// it is what sets MustChangePassword on the account, so holding an old
	// backup is never enough to keep using it.
	PasswordHash string `json:"password_hash" doc:"Bcrypt hash of the account password, as it was when the backup was made."`
	// Theme, DateFormat and GamesView default to "system", "long" and
	// "table" when a backup predates them, rather than failing to restore
	// over a display preference.
	Theme      string `json:"theme" doc:"Theme the application renders in: light, dark or system."`
	DateFormat string `json:"date_format" doc:"How a date is written out: long, ymd, dmy or mdy."`
	GamesView  string `json:"games_view" doc:"Which layout the Games page opens in by default: table or grid."`
}

// NormalisePreferences fills in Theme, DateFormat and GamesView when a
// backup predates them, or carries a value this build no longer recognises.
func (a AccountEntry) NormalisePreferences() (theme, dateFormat, gamesView string) {
	theme = a.Theme
	if theme != "light" && theme != "dark" && theme != "system" {
		theme = "system"
	}
	dateFormat = a.DateFormat
	switch dateFormat {
	case "long", "ymd", "dmy", "mdy":
	default:
		dateFormat = "long"
	}
	gamesView = a.GamesView
	if gamesView != "table" && gamesView != "grid" {
		gamesView = "table"
	}
	return theme, dateFormat, gamesView
}

// BackupDocument is a Document plus its account section, written to
// gamelog.json inside a backup .zip.
type BackupDocument struct {
	*Document
	Account AccountEntry `json:"account"`
}

// Validate reports whether an account section is well-formed enough to
// restore: a name to show, and something shaped like a bcrypt hash rather
// than an empty string or a plaintext password typed into the wrong field.
func (a AccountEntry) Validate() error {
	if strings.TrimSpace(a.Name) == "" {
		return errors.New("the backup's account section has no name")
	}
	if !strings.HasPrefix(a.PasswordHash, "$2") {
		return errors.New("the backup's account section has no valid password hash")
	}
	return nil
}
