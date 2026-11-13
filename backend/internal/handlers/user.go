package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// usersTag groups the admin's management operations.
const usersTag = "Users"

type createUserInput struct {
	Body struct {
		Username string `json:"username" minLength:"1" maxLength:"64" pattern:"\\S" patternDescription:"more than blank space" doc:"Account name. Unique, and compared ignoring case and accents." example:"martin"`
		Password string `json:"password" minLength:"8" maxLength:"72" doc:"Initial password. Between 8 and 72 characters. The account can change it afterwards."`
	}
}

type userIDInput struct {
	ID uint64 `path:"id" doc:"Id of the account." example:"2"`
}

type resetPasswordInput struct {
	ID   uint64 `path:"id" doc:"Id of the account." example:"2"`
	Body passwordBody
}

// account is an account as the admin's list shows it: with the lock that
// failed logins put on it, if any.
type account struct {
	models.User
	LockedUntil *time.Time `json:"locked_until,omitempty" doc:"Until when logins to the account are refused after too many failed attempts, from at least one address. Left out when they are not." example:"2026-11-13T18:42:00Z"`
}

type userListOutput struct {
	Body []account
}

// registerUsers registers the account management the admin does.
//
// Every operation here is admin-only. There is no self-registration anywhere in
// the API: accounts exist because the admin created them.
func registerUsers(api huma.API, service *auth.Service) {
	users := service.Users()

	// forget clears the failed logins of an account, from every address.
	forget := func(ctx context.Context, id uint64) error {
		user, err := users.Get(ctx, id)
		if err != nil {
			return err
		}
		if limiter := service.Limiter(); limiter != nil {
			limiter.Forget(user.Username)
		}
		return nil
	}

	huma.Register(api, huma.Operation{
		OperationID: "list-users",
		Method:      http.MethodGet,
		Path:        "/api/users",
		Summary:     "List accounts",
		Description: "Returns every account, the admin first, with the lock too many failed logins " +
			"put on it, if any. Password hashes are never part of the answer.",
		Tags:     []string{usersTag},
		Metadata: auth.Require(auth.AccessAdmin),
		Errors:   []int{http.StatusUnauthorized, http.StatusForbidden},
	}, func(ctx context.Context, _ *struct{}) (*userListOutput, error) {
		list, err := users.List(ctx)
		if err != nil {
			return nil, apiError(err, "no accounts")
		}
		accounts := make([]account, len(list))
		for i, user := range list {
			accounts[i] = account{User: user}
			if limiter := service.Limiter(); limiter != nil {
				if until := limiter.LockedUntil(user.Username); !until.IsZero() {
					accounts[i].LockedUntil = &until
				}
			}
		}
		return &userListOutput{Body: accounts}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "create-user",
		Method:      http.MethodPost,
		Path:        "/api/users",
		Summary:     "Create an account",
		Description: "Creates a regular account with an initial password, which its owner can " +
			"change afterwards.\n\n" +
			"The new account starts with an empty library. It sees none of the games of any " +
			"other account, and none of its own are visible to them.",
		Tags:          []string{usersTag},
		Metadata:      auth.Require(auth.AccessAdmin),
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusConflict, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *createUserInput) (*userOutput, error) {
		hash, err := auth.HashPassword(input.Body.Password)
		if err != nil {
			return nil, passwordError(err, "no such account")
		}

		user := &models.User{Username: input.Body.Username, PasswordHash: hash}
		if err := users.Create(ctx, user); err != nil {
			if errors.Is(err, repository.ErrDuplicate) {
				return nil, huma.Error409Conflict("that account name is taken")
			}
			return nil, apiError(err, "no such account")
		}

		slog.Info("account created", "username", user.Username, "id", user.ID)
		return &userOutput{Body: user}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-user",
		Method:      http.MethodDelete,
		Path:        "/api/users/{id}",
		Summary:     "Delete an account",
		Description: "Removes an account together with everything that was only ever theirs: its " +
			"games, its genres, developers, publishers and platforms, and its sessions.\n\n" +
			"This cannot be undone, and the admin cannot delete itself.",
		Tags:          []string{usersTag},
		Metadata:      auth.Require(auth.AccessAdmin),
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusConflict},
	}, func(ctx context.Context, input *userIDInput) (*struct{}, error) {
		admin, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}
		if admin.ID == input.ID {
			// Otherwise a deployment can be left with no way to manage it,
			// and with regular accounts nobody can reach.
			return nil, huma.Error409Conflict("the admin account cannot delete itself")
		}

		if err := users.Delete(ctx, input.ID); err != nil {
			return nil, apiError(err, "no account with that id")
		}

		slog.Info("account deleted", "id", input.ID)
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "reset-user-password",
		Method:      http.MethodPut,
		Path:        "/api/users/{id}/password",
		Summary:     "Reset an account's password",
		Description: "Sets a new password for an account without knowing the old one, ends " +
			"every session it had, and lifts the lock failed logins put on it, if any. This is " +
			"the recovery path for somebody who forgot theirs.",
		Tags:          []string{usersTag},
		Metadata:      auth.Require(auth.AccessAdmin),
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *resetPasswordInput) (*struct{}, error) {
		admin, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		if err := service.SetPassword(ctx, input.ID, input.Body.Password); err != nil {
			return nil, passwordError(err, "no account with that id")
		}
		if err := forget(ctx, input.ID); err != nil {
			return nil, apiError(err, "no account with that id")
		}

		// Resetting the admin's own password ends the session doing the
		// resetting too, which is correct but worth saying out loud in the
		// log rather than leaving as a surprise.
		if admin.ID == input.ID {
			slog.Info("the admin reset its own password and will have to sign in again")
		} else {
			slog.Info("account password reset", "id", input.ID)
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "unlock-user",
		Method:      http.MethodDelete,
		Path:        "/api/users/{id}/lock",
		Summary:     "Unlock an account",
		Description: "Lifts the lock that too many failed logins put on an account, from every " +
			"address, and forgets the failures counted so far. Unlocking an account that is " +
			"not locked is not an error.",
		Tags:          []string{usersTag},
		Metadata:      auth.Require(auth.AccessAdmin),
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound},
	}, func(ctx context.Context, input *userIDInput) (*struct{}, error) {
		if err := forget(ctx, input.ID); err != nil {
			return nil, apiError(err, "no account with that id")
		}
		slog.Info("account unlocked", "id", input.ID)
		return nil, nil
	})
}
