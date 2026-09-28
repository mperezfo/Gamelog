// Package handlers contains the HTTP controllers for the API.
//
// Operations are registered with Huma, which derives the OpenAPI 3.1 document
// from the Go types in this package: the parameters, schemas and status codes
// in the published documentation are the ones the code actually validates and
// returns, so documentation and behaviour cannot drift apart. There is no
// generated file to keep in sync and no build step — the spec is built from
// the same types at startup.
package handlers

import (
	"errors"
	"log/slog"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// Register wires every operation of the API onto api.
//
// Paths are written in full, including the /api prefix: the backend serves
// nothing outside it, so the prefix belongs to the operation rather than to a
// mounted sub-router, and the OpenAPI document then describes the same paths
// the frontend and the reverse proxy use.
func Register(api huma.API, db *gorm.DB, authentication *auth.Service, imagesDir, version string) {
	// Schema aliases have to be registered before the first operation, since
	// Huma builds each schema as the operation using it is registered.
	api.OpenAPI().Components.Schemas.RegisterTypeAlias(
		reflect.TypeFor[models.Status](),
		reflect.TypeFor[statusSchema](),
	)

	// Before the first operation too: huma.Register wraps each handler in the
	// middlewares the API holds at that moment, so one added afterwards would
	// silently not run for anything already registered.
	//
	// An operation that declares no access level gets auth.AccessUser, so a
	// route added here without a thought about authentication is protected
	// rather than open.
	api.UseMiddleware(auth.Middleware(api, authentication))

	registerHealth(api, db, version)
	registerAuth(api, authentication)
	registerUsers(api, authentication)
	registerGames(api, db)
	registerLookups(api, db)
	registerPortability(api, db, authentication, imagesDir)
	registerImages(api, imagesDir)
}

// statusSchema documents models.Status as an enum whose values come from
// models.Statuses(), so requests, responses and documentation all follow the
// single source of truth in the models package.
//
// It lives here, registered as a schema alias, rather than as a method on
// models.Status, to keep the models package free of any dependency on the API
// framework.
type statusSchema string

// Schema implements huma.SchemaProvider.
func (statusSchema) Schema(huma.Registry) *huma.Schema {
	statuses := models.Statuses()
	values := make([]any, 0, len(statuses))
	for _, status := range statuses {
		values = append(values, string(status))
	}

	return &huma.Schema{
		Type:        huma.TypeString,
		Title:       "Status",
		Description: "Lifecycle stage of a game, in Kanban column order.",
		Enum:        values,
	}
}

// apiError maps the repository sentinels onto HTTP responses.
//
// It is the single place that decides which failures are the client's fault:
// anything unrecognised is logged and reported as a 500 with no detail, so
// driver and SQL messages never reach the response body.
func apiError(err error, notFound string) error {
	switch {
	case errors.Is(err, repository.ErrNotFound):
		return huma.Error404NotFound(notFound)
	case errors.Is(err, repository.ErrDuplicate):
		return huma.Error409Conflict("another record already uses that name")
	case errors.Is(err, repository.ErrInUse):
		return huma.Error409Conflict(
			"some game still uses this record, so deleting it would silently change that game")
	case errors.Is(err, repository.ErrInvalidReference):
		// The driver's message names tables and constraints, so it is logged
		// rather than returned.
		slog.Info("rejected a write pointing at a missing row", "error", err)
		return huma.Error422UnprocessableEntity("a platform, genre, developer or publisher id does not exist")
	case errors.Is(err, repository.ErrInvalidSort):
		return huma.Error422UnprocessableEntity(err.Error())
	default:
		slog.Error("unexpected error while serving a request", "error", err)
		return huma.Error500InternalServerError("internal error")
	}
}
