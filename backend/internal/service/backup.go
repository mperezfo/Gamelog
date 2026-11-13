package service

import (
	"errors"
	"strings"

	"github.com/mperezfo/gamelog/internal/models"
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
	// Preferences are restored normalised (see models.Preferences.Normalise),
	// so that a backup made before one of them existed, or after one lost a
	// value, restores with its default rather than failing over a display
	// setting.
	models.Preferences
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
