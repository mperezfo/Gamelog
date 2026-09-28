package models

import "time"

// User is an account that can log in.
//
// There are no roles: IsAdmin is the whole permission system. An admin manages
// the other accounts and owns no games; everybody else owns a library and
// manages nothing but their own password.
type User struct {
	ID uint64 `gorm:"column:id;primaryKey" json:"id"`
	// Username is unique, compared ignoring case and accents like every other
	// name column in the schema, and is what signs an account in.
	Username string `gorm:"column:username" json:"username"`
	// Name is what the application shows instead — free to change without it
	// reading as a different account, unlike the username.
	Name string `gorm:"column:name" json:"name"`
	// AvatarURL points at an uploaded image the same way a game's
	// CoverImageURL does: the same upload endpoint, just a different owner.
	AvatarURL *string `gorm:"column:avatar_url" json:"avatar_url"`
	// Theme, DateFormat and GamesView are display preferences that travel
	// with the account across devices, and are what lets them be part of the
	// export/import along with the rest of the profile.
	Theme      string `gorm:"column:theme" json:"theme"`
	DateFormat string `gorm:"column:date_format" json:"date_format"`
	// GamesView is which layout the Games page opens in — 'table' or 'grid'
	// — when its URL carries no `view` of its own.
	GamesView string `gorm:"column:games_view" json:"games_view"`
	// PasswordHash is bcrypt output. The json:"-" tag is what keeps it out of
	// every response, since this struct is what the API returns.
	PasswordHash string `gorm:"column:password_hash" json:"-"`
	// MustChangePassword is set when PasswordHash was written by restoring a
	// backup rather than chosen through the application. The auth middleware
	// refuses every request but the ones about the session itself until it is
	// cleared, since a backup can be stale or have reached somebody it
	// should not have.
	MustChangePassword bool `gorm:"column:must_change_password" json:"must_change_password"`
	IsAdmin            bool `gorm:"column:is_admin" json:"is_admin"`

	CreatedAt time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at" json:"updated_at"`
}

// Session is one logged-in browser.
//
// Sessions are rows rather than self-contained tokens so that they can be
// revoked: deleting a user ends their access now instead of whenever a
// long-lived token would have expired.
type Session struct {
	// TokenHash is the SHA-256 of the token held by the cookie. The token
	// itself is never stored.
	TokenHash []byte `gorm:"column:token_hash;primaryKey" json:"-"`
	UserID    uint64 `gorm:"column:user_id" json:"-"`

	CreatedAt time.Time `gorm:"column:created_at" json:"-"`
	// LastUsedAt is written as the session is used, which is what makes an
	// abandoned session recognisable.
	LastUsedAt time.Time `gorm:"column:last_used_at" json:"-"`
	// ExpiresAt is pushed back once more than half the lifetime has been
	// spent, so a session in regular use never ends.
	ExpiresAt time.Time `gorm:"column:expires_at" json:"-"`
}
