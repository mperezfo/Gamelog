package repository

import (
	"context"
	"log/slog"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/mperezfo/gamelog/internal/models"
)

// UserRepository is the data access for accounts.
type UserRepository struct {
	db *gorm.DB
}

// NewUserRepository builds the user repository.
func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

// Create inserts an account and fills in its generated ID.
//
// It also adopts, for the first non-admin account ever created, the games that
// predate authentication: a deployment upgraded from a version without users
// has rows whose user_id is NULL, and this is the moment there is finally
// somebody to attribute them to. On a fresh deployment there are none and the
// statement is a no-op.
func (r *UserRepository) Create(ctx context.Context, user *models.User) error {
	user.Username = NormaliseUsername(user.Username)
	if user.Name == "" {
		user.Name = user.Username
	}
	applyDefaultPreferences(user)

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		if user.IsAdmin {
			// The admin owns no library, so it never adopts anything.
			return nil
		}

		var others int64
		if err := tx.Model(&models.User{}).
			Where("is_admin = ? AND id <> ?", false, user.ID).
			Count(&others).Error; err != nil {
			return err
		}
		if others > 0 {
			return nil
		}

		// Written as raw SQL rather than through the model so that adopting a
		// game does not also rewrite its updated_at: the game did not change,
		// it only acquired an owner.
		result := tx.Exec("UPDATE games SET user_id = ? WHERE user_id IS NULL", user.ID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			slog.Info("adopted games that predate authentication",
				"user", user.Username, "games", result.RowsAffected)
		}
		return nil
	})
	return translate(err)
}

// CreateFirst inserts an account only while there are none, and returns
// ErrNotEmpty otherwise. It is how the first-run bootstrap creates the admin.
//
// The count is taken FOR UPDATE inside the same transaction as the insert. On
// an empty table that takes a gap lock over the whole index, which is what
// makes two simultaneous first runs serialise instead of both succeeding —
// a race that is unlikely and would hand out a second admin account.
func (r *UserRepository) CreateFirst(ctx context.Context, user *models.User) error {
	user.Username = NormaliseUsername(user.Username)
	if user.Name == "" {
		user.Name = user.Username
	}
	applyDefaultPreferences(user)

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&models.User{}).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrNotEmpty
		}
		return tx.Create(user).Error
	})
	return translate(err)
}

// Get returns the account with that id, or ErrNotFound.
func (r *UserRepository) Get(ctx context.Context, id uint64) (*models.User, error) {
	var user models.User
	if err := r.db.WithContext(ctx).First(&user, id).Error; err != nil {
		return nil, translate(err)
	}
	return &user, nil
}

// FindByUsername returns the account with that username, or ErrNotFound.
//
// The comparison is the column's collation, which ignores case and accents, so
// logging in does not depend on remembering how the name was capitalised.
func (r *UserRepository) FindByUsername(ctx context.Context, username string) (*models.User, error) {
	var user models.User
	err := r.db.WithContext(ctx).
		Where("username = ?", NormaliseUsername(username)).
		First(&user).Error
	if err != nil {
		return nil, translate(err)
	}
	return &user, nil
}

// List returns every account, admins first and then by name, which is the
// order the management screen shows them in.
func (r *UserRepository) List(ctx context.Context) ([]models.User, error) {
	var users []models.User
	err := r.db.WithContext(ctx).
		Order("is_admin DESC, username").
		Find(&users).Error
	if err != nil {
		return nil, translate(err)
	}
	return users, nil
}

// Count returns how many accounts exist. Zero is what makes the first-run
// bootstrap available.
func (r *UserRepository) Count(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.User{}).Count(&count).Error
	return count, translate(err)
}

// Delete removes an account, and with it their games and their sessions (ON
// DELETE CASCADE on both).
func (r *UserRepository) Delete(ctx context.Context, id uint64) error {
	result := r.db.WithContext(ctx).Delete(&models.User{}, id)
	if result.Error != nil {
		return translate(result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SetPassword replaces the stored hash, and clears MustChangePassword: a
// password chosen through the application, including one typed in response
// to that flag, is never one that needs changing again right away.
func (r *UserRepository) SetPassword(ctx context.Context, id uint64, hash string) error {
	result := r.db.WithContext(ctx).
		Model(&models.User{ID: id}).
		Updates(map[string]any{"password_hash": hash, "must_change_password": false})
	if result.Error != nil {
		return translate(result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// RestoreAccount overwrites the name, avatar and password hash of an account
// from a backup, and sets MustChangePassword: the hash is the one that was
// current when the backup was made, not one anybody just typed, so the
// account is made to choose a fresh password before anything else about it
// is trusted.
func (r *UserRepository) RestoreAccount(ctx context.Context, id uint64, name string, avatarURL *string, passwordHash, theme, dateFormat, gamesView string) error {
	result := r.db.WithContext(ctx).
		Model(&models.User{ID: id}).
		Updates(map[string]any{
			"name":                 name,
			"avatar_url":           avatarURL,
			"password_hash":        passwordHash,
			"must_change_password": true,
			"theme":                theme,
			"date_format":          dateFormat,
			"games_view":           gamesView,
		})
	if result.Error != nil {
		return translate(result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateProfile replaces the name and avatar an account shows in the
// application — never the username, which is a separate, admin-only change
// (there is none exposed: it is what signs the account in, so changing it
// belongs with the rest of account management, not self-service).
func (r *UserRepository) UpdateProfile(ctx context.Context, id uint64, name string, avatarURL *string) (*models.User, error) {
	result := r.db.WithContext(ctx).
		Model(&models.User{ID: id}).
		Updates(map[string]any{"name": name, "avatar_url": avatarURL})
	if result.Error != nil {
		return nil, translate(result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

// UpdatePreferences replaces the theme, date format and default games view
// an account is shown with — the display settings that travel with the
// account instead of staying local to one browser (see the migrations that
// added them).
func (r *UserRepository) UpdatePreferences(ctx context.Context, id uint64, theme, dateFormat, gamesView string) (*models.User, error) {
	result := r.db.WithContext(ctx).
		Model(&models.User{ID: id}).
		Updates(map[string]any{"theme": theme, "date_format": dateFormat, "games_view": gamesView})
	if result.Error != nil {
		return nil, translate(result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, ErrNotFound
	}
	return r.Get(ctx, id)
}

// applyDefaultPreferences fills in the theme, date format and games view a
// brand-new account is created with, matching the columns' own DB defaults —
// GORM writes a Go zero value ("") for a NOT NULL string column explicitly
// rather than leaving it to the database default, which the enum would
// reject.
func applyDefaultPreferences(user *models.User) {
	if user.Theme == "" {
		user.Theme = "system"
	}
	if user.DateFormat == "" {
		user.DateFormat = "long"
	}
	if user.GamesView == "" {
		user.GamesView = "table"
	}
}

// NormaliseUsername is the stored form of a username: trimmed, and nothing
// else. Case and accents are the collation's business, not Go's, so that the
// name is displayed the way its owner typed it while still colliding with its
// variants in the unique index.
func NormaliseUsername(username string) string {
	return strings.TrimSpace(username)
}
