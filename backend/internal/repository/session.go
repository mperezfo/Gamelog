package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
)

// SessionRepository is the data access for logged-in browsers.
type SessionRepository struct {
	db *gorm.DB
}

// NewSessionRepository builds the session repository.
func NewSessionRepository(db *gorm.DB) *SessionRepository {
	return &SessionRepository{db: db}
}

// Create stores a new session.
func (r *SessionRepository) Create(ctx context.Context, session *models.Session) error {
	return translate(r.db.WithContext(ctx).Create(session).Error)
}

// Resolve returns the live session with that token hash together with its
// user, or ErrNotFound when the token is unknown or the session has expired.
//
// An expired row is treated exactly like a missing one: nothing distinguishes
// "your session ran out" from "that token was never valid" in the answer, and
// the row itself is swept later by DeleteExpired.
func (r *SessionRepository) Resolve(
	ctx context.Context,
	tokenHash []byte,
	now time.Time,
) (*models.Session, *models.User, error) {
	var session models.Session
	err := r.db.WithContext(ctx).
		Where("token_hash = ? AND expires_at > ?", tokenHash, now).
		First(&session).Error
	if err != nil {
		return nil, nil, translate(err)
	}

	var user models.User
	if err := r.db.WithContext(ctx).First(&user, session.UserID).Error; err != nil {
		return nil, nil, translate(err)
	}

	return &session, &user, nil
}

// Refresh writes back the two timestamps that keep a session alive.
//
// It is not called on every request: the auth service only refreshes a session
// once its stored timestamps are meaningfully stale, so that reading a page
// does not cost a write.
func (r *SessionRepository) Refresh(
	ctx context.Context,
	tokenHash []byte,
	lastUsedAt, expiresAt time.Time,
) error {
	return translate(r.db.WithContext(ctx).
		Model(&models.Session{}).
		Where("token_hash = ?", tokenHash).
		Updates(map[string]any{
			"last_used_at": lastUsedAt,
			"expires_at":   expiresAt,
		}).Error)
}

// Delete ends one session. Deleting a token that is not there is not an error:
// logging out twice is not a failure.
func (r *SessionRepository) Delete(ctx context.Context, tokenHash []byte) error {
	return translate(r.db.WithContext(ctx).
		Where("token_hash = ?", tokenHash).
		Delete(&models.Session{}).Error)
}

// DeleteForUser ends every session of one account, which is how a password
// change logs the other browsers out.
func (r *SessionRepository) DeleteForUser(ctx context.Context, userID uint64) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Delete(&models.Session{})
	return result.RowsAffected, translate(result.Error)
}

// DeleteExpired removes the sessions that are already dead. Nothing depends on
// it for correctness — Resolve ignores expired rows — it only keeps the table
// from growing forever.
func (r *SessionRepository) DeleteExpired(ctx context.Context, now time.Time) (int64, error) {
	result := r.db.WithContext(ctx).
		Where("expires_at <= ?", now).
		Delete(&models.Session{})
	return result.RowsAffected, translate(result.Error)
}
