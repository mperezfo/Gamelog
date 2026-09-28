package auth

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

// Access is how much of a session an operation needs.
type Access string

const (
	// AccessPublic needs no session at all: logging in, and the first-run
	// bootstrap.
	AccessPublic Access = "public"
	// AccessUser needs a regular account. The admin is refused, because it
	// owns no library and has no business writing into somebody else's.
	AccessUser Access = "user"
	// AccessAdmin needs the admin account.
	AccessAdmin Access = "admin"
	// AccessAny needs a session and does not care which kind: the handful of
	// operations about the session itself.
	AccessAny Access = "any"
)

// metadataKey is where an operation records the access it needs.
const metadataKey = "gamelog:access"

// Require is the operation metadata that demands an access level.
//
// Operations that say nothing get AccessUser, which is the fail-closed
// default: a new endpoint added without a thought about authentication is
// protected rather than open.
func Require(access Access) map[string]any {
	return map[string]any{metadataKey: access}
}

// accessOf reads the level an operation asked for.
func accessOf(operation *huma.Operation) Access {
	if operation == nil {
		return AccessUser
	}
	if access, ok := operation.Metadata[metadataKey].(Access); ok {
		return access
	}
	return AccessUser
}

// Middleware turns the session cookie into an account, and refuses the
// requests that are not entitled to what they are asking for.
//
// It runs for every operation registered with huma.Register. It deliberately
// does not run for the OpenAPI document, which Huma serves through the adapter
// directly: the document describes the API, it does not grant access to it.
func Middleware(api huma.API, service *Service) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		access := accessOf(ctx.Operation())
		if access == AccessPublic {
			next(ctx)
			return
		}

		cookie, err := huma.ReadCookie(ctx, CookieName)
		if err != nil {
			unauthorised(api, ctx)
			return
		}

		user, err := service.Resolve(ctx.Context(), cookie.Value)
		if err != nil {
			if !errors.Is(err, ErrNoSession) {
				slog.Error("could not resolve a session", "error", err)
				huma.WriteErr(api, ctx, http.StatusInternalServerError, "internal error")
				return
			}
			unauthorised(api, ctx)
			return
		}

		// A password restored from a backup is not one the account chose just
		// now, so nothing but the operations about the session itself —
		// checking who is signed in, changing the password, signing out —
		// work until a new one replaces it.
		if user.MustChangePassword && access != AccessAny {
			huma.WriteErr(api, ctx, http.StatusForbidden,
				"your password was restored from a backup; change it before doing anything else")
			return
		}

		switch access {
		case AccessAdmin:
			if !user.IsAdmin {
				huma.WriteErr(api, ctx, http.StatusForbidden,
					"only the admin account can manage users")
				return
			}
		case AccessUser:
			if user.IsAdmin {
				huma.WriteErr(api, ctx, http.StatusForbidden,
					"the admin account manages users and has no library of its own")
				return
			}
		}

		next(huma.WithValue(ctx, userKey{}, user))
	}
}

// unauthorised is the one answer given for an absent, unknown and expired
// session alike. Telling them apart would only tell a stranger which tokens
// once existed.
func unauthorised(api huma.API, ctx huma.Context) {
	huma.WriteErr(api, ctx, http.StatusUnauthorized, "sign in to continue")
}
