// Package auth is everything about who is making a request: passwords,
// sessions, and the middleware that turns a cookie into an account.
//
// The design it implements is deliberately small — one library per user, an
// opaque session token in a cookie, and a single is_admin boolean instead of a
// role system. The authentication section of the spec explains why each of
// those is the way it is.
package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// AdminUsername is the name of the one account that manages the others.
//
// It is fixed rather than chosen: the first run asks for a password, not for a
// name, and having one well-known management account is one less thing to
// remember about a deployment.
const AdminUsername = "admin"

// CookieName is where the session token travels.
const CookieName = "gamelog_session"

// refreshInterval is how stale a session's last_used_at is allowed to get
// before it is written back. Recording every request would turn reading a page
// into a write for no benefit: the timestamp only exists so that an abandoned
// session is recognisable.
const refreshInterval = time.Hour

var (
	// ErrInvalidCredentials is returned for both an unknown username and a
	// wrong password. Which of the two it was is never disclosed.
	ErrInvalidCredentials = errors.New("invalid username or password")
	// ErrNoSession is returned when a token is unknown, expired or absent.
	ErrNoSession = errors.New("no session")
	// ErrAlreadySetUp is returned by Bootstrap once any account exists.
	ErrAlreadySetUp = errors.New("already set up")
)

// Options are the two deployment decisions authentication needs.
type Options struct {
	// Lifetime is how long a session lasts without being used. It is long on
	// purpose: this is a private game library, not a bank.
	Lifetime time.Duration
	// SecureCookie marks the cookie Secure, which stops a browser from
	// sending it over plain HTTP. It has to be configurable rather than
	// always on: a deployment reached over http:// on a Tailscale address
	// would otherwise never send the cookie back and nobody could log in.
	SecureCookie bool
}

// Service is authentication: logging in, resolving a session, and the
// first-run bootstrap.
type Service struct {
	users    *repository.UserRepository
	sessions *repository.SessionRepository
	options  Options
}

// NewService builds the authentication service.
func NewService(db *gorm.DB, options Options) *Service {
	return &Service{
		users:    repository.NewUserRepository(db),
		sessions: repository.NewSessionRepository(db),
		options:  options,
	}
}

// Users exposes the account repository, which the admin's management
// endpoints write through.
func (s *Service) Users() *repository.UserRepository { return s.users }

// Sessions exposes the session repository, so that removing an account or
// resetting a password can end the sessions that went with it.
func (s *Service) Sessions() *repository.SessionRepository { return s.sessions }

// Session is a freshly opened session, as the caller needs it: the token to
// put in a cookie and the moment it stops working.
type Session struct {
	Token     string
	ExpiresAt time.Time
}

// Login verifies a username and a password and opens a session.
func (s *Service) Login(ctx context.Context, username, password string) (*models.User, Session, error) {
	user, err := s.users.FindByUsername(ctx, username)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			// Verify the password against a throwaway hash anyway, so that an
			// unknown username takes as long to reject as a wrong password
			// and the response time does not reveal which accounts exist.
			comparePassword(decoyHash(), password)
			return nil, Session{}, ErrInvalidCredentials
		}
		return nil, Session{}, err
	}

	if !comparePassword(user.PasswordHash, password) {
		return nil, Session{}, ErrInvalidCredentials
	}

	session, err := s.Open(ctx, user.ID)
	if err != nil {
		return nil, Session{}, err
	}
	return user, session, nil
}

// Verify reports whether a password is an account's current one, without
// opening anything. It is what a password change checks before replacing it:
// going through Login instead would leave a session behind on every check.
func (s *Service) Verify(user *models.User, password string) bool {
	return comparePassword(user.PasswordHash, password)
}

// Open starts a session for an account that has already been vouched for.
func (s *Service) Open(ctx context.Context, userID uint64) (Session, error) {
	token, hash, err := newToken()
	if err != nil {
		return Session{}, err
	}

	now := time.Now().UTC()
	record := &models.Session{
		TokenHash:  hash,
		UserID:     userID,
		CreatedAt:  now,
		LastUsedAt: now,
		ExpiresAt:  now.Add(s.options.Lifetime),
	}
	if err := s.sessions.Create(ctx, record); err != nil {
		return Session{}, err
	}

	return Session{Token: token, ExpiresAt: record.ExpiresAt}, nil
}

// Resolve turns a token into the account it belongs to, or ErrNoSession.
func (s *Service) Resolve(ctx context.Context, token string) (*models.User, error) {
	if token == "" {
		return nil, ErrNoSession
	}

	now := time.Now().UTC()
	session, user, err := s.sessions.Resolve(ctx, HashToken(token), now)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return nil, ErrNoSession
		}
		return nil, err
	}

	s.refresh(ctx, session, now)
	return user, nil
}

// Logout ends the session a token names. Ending one that is not there is not
// an error: logging out twice is not a failure.
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.sessions.Delete(ctx, HashToken(token))
}

// refresh keeps a session that is in use alive.
//
// The expiry is pushed back once more than half the lifetime has been spent,
// which is what makes a session that is opened every few months never end.
// Neither write happens on every request, and neither is worth failing a
// request over: a session that could not be refreshed still works.
func (s *Service) refresh(ctx context.Context, session *models.Session, now time.Time) {
	renew := session.ExpiresAt.Sub(now) < s.options.Lifetime/2
	stale := now.Sub(session.LastUsedAt) > refreshInterval
	if !renew && !stale {
		return
	}

	expiry := session.ExpiresAt
	if renew {
		expiry = now.Add(s.options.Lifetime)
	}

	if err := s.sessions.Refresh(ctx, session.TokenHash, now, expiry); err != nil {
		slog.Warn("could not refresh a session", "error", err)
	}
}

// Pending reports whether the first-run bootstrap is still available, which is
// exactly "there are no accounts yet".
func (s *Service) Pending(ctx context.Context) (bool, error) {
	count, err := s.users.Count(ctx)
	if err != nil {
		return false, err
	}
	return count == 0, nil
}

// Bootstrap creates the admin account on a deployment that has none, and
// returns ErrAlreadySetUp on one that does.
func (s *Service) Bootstrap(ctx context.Context, password string) (*models.User, error) {
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &models.User{Username: AdminUsername, PasswordHash: hash, IsAdmin: true}
	if err := s.users.CreateFirst(ctx, user); err != nil {
		if errors.Is(err, repository.ErrNotEmpty) {
			return nil, ErrAlreadySetUp
		}
		return nil, err
	}

	slog.Info("admin account created", "username", user.Username)
	return user, nil
}

// SetPassword replaces an account's password and ends every session it had.
//
// Ending the sessions is the point of changing a password: a browser somebody
// else is holding open must stop working. The caller reopens its own session
// afterwards when the account is the one asking.
func (s *Service) SetPassword(ctx context.Context, userID uint64, password string) error {
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	if err := s.users.SetPassword(ctx, userID, hash); err != nil {
		return err
	}
	if _, err := s.sessions.DeleteForUser(ctx, userID); err != nil {
		return err
	}
	return nil
}

// RestoreAccount writes the profile and password hash a backup carries, and
// ends every session the account had — the same as SetPassword, and for the
// same reason: the hash just written is not one the account chose just now,
// so nothing that was signed in before this moment should stay that way.
//
// The caller reopens its own session afterwards, same as SetPassword's.
func (s *Service) RestoreAccount(ctx context.Context, userID uint64, name string, avatarURL *string, passwordHash, theme, dateFormat, gamesView string) error {
	if err := s.users.RestoreAccount(ctx, userID, name, avatarURL, passwordHash, theme, dateFormat, gamesView); err != nil {
		return err
	}
	_, err := s.sessions.DeleteForUser(ctx, userID)
	return err
}

// Cookie is the Set-Cookie carrying a session.
//
// HttpOnly keeps the token out of reach of any script on the page, SameSite
// Lax is what stops another site from making a browser use the session, and
// MaxAge rather than a session cookie is what survives closing the browser —
// which is the whole point of a year-long session.
func (s *Service) Cookie(session Session) http.Cookie {
	return http.Cookie{
		Name:     CookieName,
		Value:    session.Token,
		Path:     "/",
		MaxAge:   int(s.options.Lifetime.Seconds()),
		HttpOnly: true,
		Secure:   s.options.SecureCookie,
		SameSite: http.SameSiteLaxMode,
	}
}

// ClearCookie is the Set-Cookie that removes the session cookie. Its
// attributes have to match the ones it was set with or the browser keeps the
// original.
func (s *Service) ClearCookie() http.Cookie {
	return http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.options.SecureCookie,
		SameSite: http.SameSiteLaxMode,
	}
}
