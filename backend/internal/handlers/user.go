package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// usersTag groups the admin's management operations.
const usersTag = "Users"

type createUserInput struct {
	Body struct {
		Username string `json:"username" minLength:"1" maxLength:"64" doc:"Account name. Unique, and compared ignoring case and accents." example:"martin"`
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

type userListOutput struct {
	Body []models.User
}

// registerUsers registers the account management the admin does.
//
// Every operation here is admin-only. There is no self-registration anywhere in
// the API: accounts exist because the admin created them.
func registerUsers(api huma.API, service *auth.Service) {
	users := service.Users()

	huma.Register(api, huma.Operation{
		OperationID: "list-users",
		Method:      http.MethodGet,
		Path:        "/api/users",
		Summary:     "List accounts",
		Description: "Returns every account, the admin first. Password hashes are never part of the answer.",
		Tags:        []string{usersTag},
		Metadata:    auth.Require(auth.AccessAdmin),
		Errors:      []int{http.StatusUnauthorized, http.StatusForbidden},
	}, func(ctx context.Context, _ *struct{}) (*userListOutput, error) {
		list, err := users.List(ctx)
		if err != nil {
			return nil, apiError(err, "no accounts")
		}
		return &userListOutput{Body: list}, nil
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
		Description: "Sets a new password for an account without knowing the old one, and ends " +
			"every session it had. This is the recovery path for somebody who forgot theirs.",
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
}
