package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// lookupBody is the writable half of the four simple entities,
// which share the same id/name/icon shape and therefore the same operations.
//
// The name is capped at 100 characters, the shortest of the four columns
// (genres and platforms; developers and publishers allow 150). One shared
// limit keeps a single schema in the documentation and makes it impossible for
// a request to reach the database and fail there on length.
type lookupBody struct {
	Name string  `json:"name" minLength:"1" maxLength:"100" doc:"Name. Unique, and compared ignoring case and accents." example:"Metroidvania"`
	Icon *string `json:"icon,omitempty" maxLength:"100" doc:"Emoji or short icon shown next to the name." example:"🗺️"`
	// Color only has a column on platforms (migration 00003): genres,
	// developers and publishers accept it in the same shared body but the
	// three of them silently ignore it, the same trade-off already made for
	// icon on those three — one schema in the
	// documentation rather than a near-duplicate endpoint for platforms alone.
	Color *string `json:"color,omitempty" pattern:"^#[0-9a-fA-F]{6}$" doc:"Hex color. Platforms only." example:"#3b82f6"`
}

type lookupIDInput struct {
	ID uint64 `path:"id" doc:"Id of the record." example:"1"`
}

type createLookupInput struct {
	Body lookupBody
}

type updateLookupInput struct {
	ID   uint64 `path:"id" doc:"Id of the record." example:"1"`
	Body lookupBody
}

type lookupOutput[T repository.Lookup] struct {
	Body *T
}

type lookupListOutput[T repository.Lookup] struct {
	Body []T
}

// lookupMeta is the wording of one entity: everything that differs between
// /api/genres, /api/developers, /api/publishers and /api/platforms.
type lookupMeta struct {
	// singular names the entity in operation ids and error messages ("genre").
	singular string
	// plural is the path segment and the OpenAPI tag ("genres").
	plural string
	// tag is the group the operations appear under in the documentation.
	tag string
}

// registerLookups registers the CRUD of the four simple entities.
//
// Listing the games of one of them is not a route of its own: it is the
// genre_id, developer_id, publisher_id or platform_id filter of GET
// /api/games, which already has to support the same joins.
func registerLookups(api huma.API, db *gorm.DB) {
	registerLookup(api, db,
		lookupMeta{singular: "genre", plural: "genres", tag: "Genres"},
		func(id uint64, body lookupBody) models.Genre {
			return models.Genre{ID: id, Name: body.name(), Icon: body.Icon}
		})

	registerLookup(api, db,
		lookupMeta{singular: "developer", plural: "developers", tag: "Developers"},
		func(id uint64, body lookupBody) models.Developer {
			return models.Developer{ID: id, Name: body.name(), Icon: body.Icon}
		})

	registerLookup(api, db,
		lookupMeta{singular: "publisher", plural: "publishers", tag: "Publishers"},
		func(id uint64, body lookupBody) models.Publisher {
			return models.Publisher{ID: id, Name: body.name(), Icon: body.Icon}
		})

	registerLookup(api, db,
		lookupMeta{singular: "platform", plural: "platforms", tag: "Platforms"},
		func(id uint64, body lookupBody) models.Platform {
			return models.Platform{ID: id, Name: body.name(), Icon: body.Icon, Color: body.Color}
		})
}

// lookupRepo returns the repository for one entity, scoped to the account
// making the request — built per request, like library(), because a lookup
// repository is now scoped to an owner the same way a game repository is
// (see migration 00013).
func lookupRepo[T repository.Lookup](ctx context.Context, db *gorm.DB) (*repository.LookupRepository[T], error) {
	user, err := currentUser(ctx)
	if err != nil {
		return nil, err
	}
	return repository.NewLookupRepository[T](db, user.ID), nil
}

// name is the stored form of the submitted name.
func (b lookupBody) name() string { return strings.TrimSpace(b.Name) }

// registerLookup registers the five operations of one simple entity.
//
// build turns a request body into the entity, which is the only part that
// cannot be generic: Go has no way to set a field on a type parameter. The
// repository is built inside each handler rather than once here, since it is
// now scoped to the account making the request (see lookupRepo).
func registerLookup[T repository.Lookup](
	api huma.API,
	db *gorm.DB,
	meta lookupMeta,
	build func(id uint64, body lookupBody) T,
) {
	var (
		collection = "/api/" + meta.plural
		item       = collection + "/{id}"
		notFound   = "no " + meta.singular + " with that id"
		tags       = []string{meta.tag}
	)

	huma.Register(api, huma.Operation{
		OperationID: "list-" + meta.plural,
		Method:      http.MethodGet,
		Path:        collection,
		Summary:     "List " + meta.plural,
		Description: "Returns every " + meta.singular + " in your library, ordered by name.",
		Tags:        tags,
		Errors:      []int{http.StatusUnauthorized},
	}, func(ctx context.Context, _ *struct{}) (*lookupListOutput[T], error) {
		repo, err := lookupRepo[T](ctx, db)
		if err != nil {
			return nil, err
		}
		entities, err := repo.List(ctx)
		if err != nil {
			return nil, apiError(err, notFound)
		}
		return &lookupListOutput[T]{Body: entities}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-" + meta.singular,
		Method:      http.MethodGet,
		Path:        item,
		Summary:     "Get a " + meta.singular,
		Tags:        tags,
		Errors:      []int{http.StatusUnauthorized, http.StatusNotFound},
	}, func(ctx context.Context, input *lookupIDInput) (*lookupOutput[T], error) {
		repo, err := lookupRepo[T](ctx, db)
		if err != nil {
			return nil, err
		}
		entity, err := repo.Get(ctx, input.ID)
		if err != nil {
			return nil, apiError(err, notFound)
		}
		return &lookupOutput[T]{Body: entity}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-" + meta.singular,
		Method:        http.MethodPost,
		Path:          collection,
		Summary:       "Create a " + meta.singular,
		Tags:          tags,
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusUnauthorized, http.StatusConflict},
	}, func(ctx context.Context, input *createLookupInput) (*lookupOutput[T], error) {
		repo, err := lookupRepo[T](ctx, db)
		if err != nil {
			return nil, err
		}
		entity := build(0, input.Body)
		if err := repo.Create(ctx, &entity); err != nil {
			return nil, apiError(err, notFound)
		}
		return &lookupOutput[T]{Body: &entity}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-" + meta.singular,
		Method:      http.MethodPut,
		Path:        item,
		Summary:     "Replace a " + meta.singular,
		Description: "Overwrites every field: an icon left out of the body is cleared.",
		Tags:        tags,
		Errors:      []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusConflict},
	}, func(ctx context.Context, input *updateLookupInput) (*lookupOutput[T], error) {
		repo, err := lookupRepo[T](ctx, db)
		if err != nil {
			return nil, err
		}
		entity := build(input.ID, input.Body)
		if err := repo.Update(ctx, &entity); err != nil {
			return nil, apiError(err, notFound)
		}
		return &lookupOutput[T]{Body: &entity}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "delete-" + meta.singular,
		Method:        http.MethodDelete,
		Path:          item,
		Summary:       "Delete a " + meta.singular,
		Description:   "Games keep existing: they simply lose the " + meta.singular + ".",
		Tags:          tags,
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusNotFound},
	}, func(ctx context.Context, input *lookupIDInput) (*struct{}, error) {
		repo, err := lookupRepo[T](ctx, db)
		if err != nil {
			return nil, err
		}
		if err := repo.Delete(ctx, input.ID); err != nil {
			return nil, apiError(err, notFound)
		}
		return nil, nil
	})
}
