package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/models"
)

// authTag groups the operations about the session itself.
const authTag = "Authentication"

// passwordBody is a request body that carries nothing but a new password. The
// bounds are auth's: below the minimum nothing is worth hashing, and past the
// maximum bcrypt would silently ignore the rest.
type passwordBody struct {
	Password string `json:"password" minLength:"8" maxLength:"72" doc:"The new password. Between 8 and 72 characters."`
}

type loginInput struct {
	Body struct {
		Username string `json:"username" minLength:"1" maxLength:"64" doc:"Account name. Compared ignoring case and accents." example:"martin"`
		Password string `json:"password" minLength:"1" maxLength:"72" doc:"Account password."`
	}
}

// sessionOutput is the answer to anything that opens a session: the account,
// and the cookie that will carry it from now on.
type sessionOutput struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
	Body      *models.User
}

type userOutput struct {
	Body *models.User
}

// logoutInput reads the cookie directly rather than taking it from the
// middleware, because ending a session needs the token and not the account.
//
// The name has to be spelled out here — a struct tag cannot hold a constant —
// so it is auth.CookieName written twice. A divergence does not go unnoticed:
// logging out would then find no token to delete and the session would survive
// it, which is what the test around logging out checks.
type logoutInput struct {
	Session http.Cookie `cookie:"gamelog_session"`
}

type clearedSessionOutput struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
}

type changePasswordInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" minLength:"1" maxLength:"72" doc:"The password being replaced."`
		NewPassword     string `json:"new_password" minLength:"8" maxLength:"72" doc:"The new password. Between 8 and 72 characters."`
	}
}

type updateProfileInput struct {
	Body struct {
		Name string `json:"name" minLength:"1" maxLength:"100" doc:"Name shown in the application. The username used to sign in is unaffected." example:"Martín"`
		// uri-reference rather than uri: an avatar almost always points at
		// this deployment's own /api/images/{name} (see the Images tag),
		// which has no scheme of its own to be absolute with.
		AvatarURL *string `json:"avatar_url,omitempty" format:"uri-reference" maxLength:"2048" doc:"URL or path of the profile picture. Omitted or null clears it."`
	}
}

type updatePreferencesInput struct {
	Body struct {
		Theme      string `json:"theme" enum:"light,dark,system" doc:"Which theme the application renders in."`
		DateFormat string `json:"date_format" enum:"long,ymd,dmy,mdy" doc:"How a date is written out: 'long' (Dec 31, 2023), 'ymd' (2023/12/31), 'dmy' (31/12/2023) or 'mdy' (12/31/2023)."`
		GamesView  string `json:"games_view" enum:"table,grid" doc:"Which layout the Games page opens in when its URL carries no view of its own."`
	}
}

type setupStatusOutput struct {
	Body struct {
		Pending bool `json:"pending" doc:"Whether the deployment still has no accounts, and the admin account is waiting to be created."`
		// The name is reported rather than chosen, so that the setup screen
		// can show what the account about to be created is called.
		AdminUsername string `json:"admin_username" doc:"Name of the admin account." example:"admin"`
	}
}

type setupInput struct {
	Body passwordBody
}

// registerAuth registers logging in, logging out, and the first run.
func registerAuth(api huma.API, service *auth.Service) {
	huma.Register(api, huma.Operation{
		OperationID: "login",
		Method:      http.MethodPost,
		Path:        "/api/auth/login",
		Summary:     "Log in",
		Description: "Verifies a username and a password and opens a session.\n\n" +
			"The session travels in an `HttpOnly` cookie, so a browser needs to do nothing " +
			"with the answer but read the account it describes. Sessions are long-lived on " +
			"purpose and renew themselves while they are used.\n\n" +
			"An unknown username and a wrong password give the same answer, and take the " +
			"same time.",
		Tags:     []string{authTag},
		Metadata: auth.Require(auth.AccessPublic),
		Errors:   []int{http.StatusUnauthorized},
	}, func(ctx context.Context, input *loginInput) (*sessionOutput, error) {
		user, session, err := service.Login(ctx, input.Body.Username, input.Body.Password)
		if err != nil {
			if errors.Is(err, auth.ErrInvalidCredentials) {
				return nil, huma.Error401Unauthorized("invalid username or password")
			}
			return nil, apiError(err, "no such account")
		}

		return &sessionOutput{SetCookie: service.Cookie(session), Body: user}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "logout",
		Method:        http.MethodPost,
		Path:          "/api/auth/logout",
		Summary:       "Log out",
		Description:   "Ends the current session and clears the cookie. Logging out twice is not an error.",
		Tags:          []string{authTag},
		Metadata:      auth.Require(auth.AccessPublic),
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, input *logoutInput) (*clearedSessionOutput, error) {
		if err := service.Logout(ctx, input.Session.Value); err != nil {
			return nil, apiError(err, "no session")
		}
		return &clearedSessionOutput{SetCookie: service.ClearCookie()}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-current-user",
		Method:      http.MethodGet,
		Path:        "/api/auth/me",
		Summary:     "Who am I",
		Description: "Returns the account the session belongs to, or 401 when there is no session. " +
			"It is what a frontend asks first, to decide between the login screen and the application.",
		Tags:     []string{authTag},
		Metadata: auth.Require(auth.AccessAny),
		Errors:   []int{http.StatusUnauthorized},
	}, func(ctx context.Context, _ *struct{}) (*userOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}
		return &userOutput{Body: user}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "change-own-password",
		Method:      http.MethodPut,
		Path:        "/api/auth/password",
		Summary:     "Change your own password",
		Description: "Replaces your password, which ends every other session the account had. " +
			"The session making the request is replaced by a fresh one, so the browser doing " +
			"the change stays logged in and the others do not.",
		Tags:     []string{authTag},
		Metadata: auth.Require(auth.AccessAny),
		Errors:   []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *changePasswordInput) (*sessionOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		// Knowing the current password is what makes this a password change
		// rather than a way for an unattended browser to lock its owner out.
		if !service.Verify(user, input.Body.CurrentPassword) {
			return nil, huma.Error401Unauthorized("the current password is not right")
		}

		if err := service.SetPassword(ctx, user.ID, input.Body.NewPassword); err != nil {
			return nil, passwordError(err, "no such account")
		}
		// SetPassword clears the flag in the database; user was read before
		// that write, so the copy has to be told by hand.
		user.MustChangePassword = false

		session, err := service.Open(ctx, user.ID)
		if err != nil {
			return nil, apiError(err, "no such account")
		}
		return &sessionOutput{SetCookie: service.Cookie(session), Body: user}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-own-profile",
		Method:      http.MethodPut,
		Path:        "/api/auth/profile",
		Summary:     "Update your own profile",
		Description: "Changes the name and profile picture shown in the application. " +
			"The username used to sign in is unaffected — there is no self-service way to " +
			"change it.",
		Tags:     []string{authTag},
		Metadata: auth.Require(auth.AccessAny),
		Errors:   []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *updateProfileInput) (*userOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		updated, err := service.Users().UpdateProfile(ctx, user.ID, strings.TrimSpace(input.Body.Name), input.Body.AvatarURL)
		if err != nil {
			return nil, apiError(err, "no such account")
		}
		return &userOutput{Body: updated}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-own-preferences",
		Method:      http.MethodPut,
		Path:        "/api/auth/preferences",
		Summary:     "Update your own display preferences",
		Description: "Changes the theme, date format and default games view the application renders " +
			"with. All three travel with the account rather than the browser, so they are also " +
			"part of the library export and import.",
		Tags:     []string{authTag},
		Metadata: auth.Require(auth.AccessAny),
		Errors:   []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *updatePreferencesInput) (*userOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		updated, err := service.Users().UpdatePreferences(ctx, user.ID, input.Body.Theme, input.Body.DateFormat, input.Body.GamesView)
		if err != nil {
			return nil, apiError(err, "no such account")
		}
		return &userOutput{Body: updated}, nil
	})

	registerSetup(api, service)
}

// registerSetup registers the first-run bootstrap.
func registerSetup(api huma.API, service *auth.Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-setup-status",
		Method:      http.MethodGet,
		Path:        "/api/setup",
		Summary:     "Is the first run still pending",
		Description: "Reports whether the deployment has no accounts yet. While that is the case, " +
			"the admin account can be created without authenticating; once any account exists " +
			"the window is closed for good.",
		Tags:     []string{authTag},
		Metadata: auth.Require(auth.AccessPublic),
	}, func(ctx context.Context, _ *struct{}) (*setupStatusOutput, error) {
		pending, err := service.Pending(ctx)
		if err != nil {
			return nil, apiError(err, "no accounts")
		}

		out := &setupStatusOutput{}
		out.Body.Pending = pending
		out.Body.AdminUsername = auth.AdminUsername
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "run-setup",
		Method:      http.MethodPost,
		Path:        "/api/setup",
		Summary:     "Create the admin account",
		Description: "Creates the admin account and logs in as it. Refused with 409 once any " +
			"account exists.\n\n" +
			"The admin manages the other accounts and owns no library: it cannot reach the " +
			"games, the genres or the import and export.",
		Tags:          []string{authTag},
		Metadata:      auth.Require(auth.AccessPublic),
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusConflict, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *setupInput) (*sessionOutput, error) {
		user, err := service.Bootstrap(ctx, input.Body.Password)
		if err != nil {
			if errors.Is(err, auth.ErrAlreadySetUp) {
				return nil, huma.Error409Conflict("this deployment already has accounts")
			}
			return nil, passwordError(err, "no such account")
		}

		session, err := service.Open(ctx, user.ID)
		if err != nil {
			return nil, apiError(err, "no such account")
		}
		return &sessionOutput{SetCookie: service.Cookie(session), Body: user}, nil
	})
}

// currentUser returns the account a request was authenticated as.
//
// The middleware makes the failure unreachable: an operation either declares
// itself public, in which case no handler asks this, or it has an account by
// the time the handler runs. Reaching it means an operation was registered
// with the wrong access level, which is a bug rather than a bad request.
func currentUser(ctx context.Context) (*models.User, error) {
	user, ok := auth.UserFrom(ctx)
	if !ok {
		slog.Error("a handler that needs an account ran without one")
		return nil, huma.Error500InternalServerError("internal error")
	}
	return user, nil
}

// passwordError maps a rejected password onto a 422, and anything else onto
// the shared mapping.
func passwordError(err error, notFound string) error {
	if errors.Is(err, auth.ErrWeakPassword) {
		return huma.Error422UnprocessableEntity(auth.ErrWeakPassword.Error())
	}
	return apiError(err, notFound)
}
