package auth

import (
	"context"

	"github.com/mperezfo/gamelog/internal/models"
)

// userKey is the context key the middleware stores the account under. It is an
// unexported empty struct so that nothing outside this package can collide
// with it or set it by hand.
type userKey struct{}

// WithUser returns a context carrying the authenticated account.
func WithUser(ctx context.Context, user *models.User) context.Context {
	return context.WithValue(ctx, userKey{}, user)
}

// UserFrom returns the account a request was authenticated as.
//
// It reports false only for an operation the middleware let through without a
// session, which is to say a public one.
func UserFrom(ctx context.Context) (*models.User, bool) {
	user, ok := ctx.Value(userKey{}).(*models.User)
	return user, ok && user != nil
}
