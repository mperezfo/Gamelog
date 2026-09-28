package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// gameBody is the writable half of a game.
//
// It is a separate type from models.Game on purpose: id, created_at and
// updated_at belong to the server, and the N:M relations are written as ids so
// that saving a game can never create or rename a genre.
type gameBody struct {
	Title  string        `json:"title" minLength:"1" maxLength:"255" doc:"Title of the game." example:"Hollow Knight"`
	Status models.Status `json:"status" doc:"Lifecycle stage of the game."`

	// Required rather than omitempty: leaving it out of a PUT would silently
	// reset it to zero (PUT replaces the whole game), which is the one field where
	// that would visibly reshuffle the dashboard's board. A client that does
	// not care about manual order can always echo back what it last read.
	Position float64 `json:"position" doc:"Manual order within its status column, for drag-and-drop; lower sorts first among games tied on release date (or with none)."`

	// Scores are stored as DECIMAL(3,1): anything beyond one decimal is
	// rounded by the database.
	Score   *float64 `json:"score,omitempty" minimum:"0" maximum:"10" doc:"Personal score from 0 to 10, with one decimal. Null while the game is unplayed." example:"9.2"`
	Tagline *string  `json:"tagline,omitempty" maxLength:"255" doc:"Very short personal description, the equivalent of the \"Four words\" Notion field." example:"Lonely bug, big map"`
	Notes   *string  `json:"notes,omitempty" doc:"Free-form notes."`

	// uri-reference rather than uri: a cover almost always points at this
	// deployment's own /api/images/{name} (see the Images tag), which has no
	// scheme of its own to be absolute with. A plain external URL still
	// validates too, for a library imported before uploads existed.
	CoverImageURL *string `json:"cover_image_url,omitempty" format:"uri-reference" maxLength:"2048" doc:"URL or path of the cover image."`

	// Where a portrait crop of the cover should be centred, as a fraction of
	// the image's width/height. Null means centre.
	CoverFocalX *float64 `json:"cover_focal_x,omitempty" minimum:"0" maximum:"1" doc:"Horizontal centre of the portrait crop, from 0 (left) to 1 (right). Null centres it."`
	CoverFocalY *float64 `json:"cover_focal_y,omitempty" minimum:"0" maximum:"1" doc:"Vertical centre of the portrait crop, from 0 (top) to 1 (bottom). Null centres it."`
	CoverZoom   *float64 `json:"cover_zoom,omitempty" minimum:"1" maximum:"3" doc:"How far to zoom in on the portrait crop, anchored at the focal point. Null or 1 means no zoom."`

	// RFC 3339 in the request and the response alike (e.g. "2024-05-17T00:00:00Z")
	// even though only the date part is stored: time.Time only (un)marshals
	// JSON that way, and a second date format just for these two fields would
	// be one more thing for a client to get wrong.
	ReleaseDate *time.Time `json:"release_date,omitempty" doc:"Release date of the game, RFC 3339. Only the date part is stored." example:"2024-05-17T00:00:00Z"`
	LoggedDate  *time.Time `json:"logged_date,omitempty" doc:"When the game was started, logged or finished, RFC 3339. Only the date part is stored." example:"2024-05-17T00:00:00Z"`

	PlatformID *uint64 `json:"platform_id,omitempty" doc:"Platform the game was played on. Must exist."`

	GenreIDs     []uint64 `json:"genre_ids,omitempty" doc:"Genres of the game. Every id must exist. Repeated ids are ignored."`
	DeveloperIDs []uint64 `json:"developer_ids,omitempty" doc:"Developers of the game. Every id must exist. Repeated ids are ignored."`
	PublisherIDs []uint64 `json:"publisher_ids,omitempty" doc:"Publishers of the game. Every id must exist. Repeated ids are ignored."`
}

// model turns the request body into the pair the repository expects.
func (b gameBody) model(id uint64) (*models.Game, repository.GameRelations) {
	return &models.Game{
			ID:            id,
			Title:         strings.TrimSpace(b.Title),
			Status:        b.Status,
			Position:      b.Position,
			Score:         b.Score,
			Tagline:       b.Tagline,
			Notes:         b.Notes,
			CoverImageURL: b.CoverImageURL,
			CoverFocalX:   b.CoverFocalX,
			CoverFocalY:   b.CoverFocalY,
			CoverZoom:     b.CoverZoom,
			ReleaseDate:   b.ReleaseDate,
			LoggedDate:    b.LoggedDate,
			PlatformID:    b.PlatformID,
		}, repository.GameRelations{
			GenreIDs:     b.GenreIDs,
			DeveloperIDs: b.DeveloperIDs,
			PublisherIDs: b.PublisherIDs,
		}
}

// gameIDInput is the path of the single-game operations.
//
// Ref is a string rather than a uint64 because it accepts either the game's
// numeric id or its slug (see internal/slug) — resolveGame turns it into an
// id before anything touches the repository's id-keyed methods.
type gameIDInput struct {
	Ref string `path:"id" doc:"Id or slug of the game." example:"hollow-knight"`
}

type createGameInput struct {
	Body gameBody
}

type updateGameInput struct {
	Ref  string `path:"id" doc:"Id or slug of the game." example:"hollow-knight"`
	Body gameBody
}

// resolveGame turns a gameIDInput's Ref into the numeric id the repository's
// Get/Update/Delete expect, so every operation below accepts a slug exactly
// where it used to only accept an id.
func resolveGame(ctx context.Context, repo *repository.GameRepository, ref string) (uint64, error) {
	id, err := repo.Resolve(ctx, ref)
	if err != nil {
		return 0, apiError(err, "no game with that id or slug")
	}
	return id, nil
}

type gameOutput struct {
	Body *models.Game
}

type gameListOutput struct {
	Body []models.Game
}

type gameStatsOutput struct {
	Body repository.GameStats
}

// listGamesInput: the same filters the table, the board
// and the calendar views need.
//
// Filters are plain values rather than pointers, which Huma does not support
// for parameters: an omitted filter arrives as the zero value, and zero is not
// a valid id or status, so it unambiguously means "no filter".
type listGamesInput struct {
	Status      models.Status `query:"status" doc:"Keep only games in this status."`
	PlatformID  uint64        `query:"platform_id" doc:"Keep only games played on this platform." example:"1"`
	GenreID     uint64        `query:"genre_id" doc:"Keep only games with this genre." example:"1"`
	DeveloperID uint64        `query:"developer_id" doc:"Keep only games by this developer." example:"1"`
	PublisherID uint64        `query:"publisher_id" doc:"Keep only games from this publisher." example:"1"`

	// The sort values must stay in sync with repository.SortFields(), which a
	// test in this package checks.
	Sort  string `query:"sort" enum:"title,status,score,release_date,logged_date,created_at,updated_at" default:"title" doc:"Field to sort by."`
	Order string `query:"order" enum:"asc,desc" default:"asc" doc:"Sort direction."`
}

// statsGamesInput takes the same filters as the listing, so the aggregates
// always describe exactly the rows on screen.
type statsGamesInput struct {
	Status      models.Status `query:"status" doc:"Keep only games in this status."`
	PlatformID  uint64        `query:"platform_id" doc:"Keep only games played on this platform." example:"1"`
	GenreID     uint64        `query:"genre_id" doc:"Keep only games with this genre." example:"1"`
	DeveloperID uint64        `query:"developer_id" doc:"Keep only games by this developer." example:"1"`
	PublisherID uint64        `query:"publisher_id" doc:"Keep only games from this publisher." example:"1"`
}

// gameFilter builds the repository filter shared by the listing and the
// aggregates. A zero id or an empty status means the filter is not applied.
func gameFilter(status models.Status, platformID, genreID, developerID, publisherID uint64) repository.GameFilter {
	filter := repository.GameFilter{}

	if status != "" {
		filter.Status = &status
	}
	if platformID != 0 {
		filter.PlatformID = &platformID
	}
	if genreID != 0 {
		filter.GenreID = &genreID
	}
	if developerID != 0 {
		filter.DeveloperID = &developerID
	}
	if publisherID != 0 {
		filter.PublisherID = &publisherID
	}

	return filter
}

// library returns the game repository for the account making the request.
//
// It is built per request rather than once at registration because a game
// repository is scoped to an owner: there is no such thing as "the" library,
// only somebody's.
func library(ctx context.Context, db *gorm.DB) (*repository.GameRepository, error) {
	user, err := currentUser(ctx)
	if err != nil {
		return nil, err
	}
	return repository.NewGameRepository(db, user.ID), nil
}

// registerGames registers the operations of the main entity.
//
// Every one of them acts on the caller's own library and cannot see another
// account's games: an id belonging to somebody else is a 404, exactly like an
// id that never existed.
func registerGames(api huma.API, db *gorm.DB) {
	huma.Register(api, huma.Operation{
		OperationID: "list-games",
		Method:      http.MethodGet,
		Path:        "/api/games",
		Summary:     "List games",
		Description: "Returns your games matching the filters, with their platform, genres, developers and publishers loaded.",
		Tags:        []string{"Games"},
		Errors:      []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *listGamesInput) (*gameListOutput, error) {
		repo, err := library(ctx, db)
		if err != nil {
			return nil, err
		}

		filter := gameFilter(input.Status, input.PlatformID, input.GenreID, input.DeveloperID, input.PublisherID)
		filter.Sort = input.Sort
		filter.Descending = input.Order == "desc"

		games, err := repo.List(ctx, filter)
		if err != nil {
			return nil, apiError(err, "no games found")
		}
		return &gameListOutput{Body: games}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-game-stats",
		Method:      http.MethodGet,
		Path:        "/api/games/stats",
		Summary:     "Aggregate games",
		Description: "Count, average score and logged-date range for your games matching the filters: the footer of the table view.",
		Tags:        []string{"Games"},
		Errors:      []int{http.StatusUnauthorized},
	}, func(ctx context.Context, input *statsGamesInput) (*gameStatsOutput, error) {
		repo, err := library(ctx, db)
		if err != nil {
			return nil, err
		}

		filter := gameFilter(input.Status, input.PlatformID, input.GenreID, input.DeveloperID, input.PublisherID)

		stats, err := repo.Stats(ctx, filter)
		if err != nil {
			return nil, apiError(err, "no games found")
		}
		return &gameStatsOutput{Body: stats}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-game",
		Method:      http.MethodGet,
		Path:        "/api/games/{id}",
		Summary:     "Get a game",
		Tags:        []string{"Games"},
		Errors:      []int{http.StatusUnauthorized, http.StatusNotFound},
	}, func(ctx context.Context, input *gameIDInput) (*gameOutput, error) {
		repo, err := library(ctx, db)
		if err != nil {
			return nil, err
		}

		id, err := resolveGame(ctx, repo, input.Ref)
		if err != nil {
			return nil, err
		}

		game, err := repo.Get(ctx, id)
		if err != nil {
			return nil, apiError(err, "no game with that id")
		}
		return &gameOutput{Body: game}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-game",
		Method:        http.MethodPost,
		Path:          "/api/games",
		Summary:       "Create a game",
		Tags:          []string{"Games"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *createGameInput) (*gameOutput, error) {
		repo, err := library(ctx, db)
		if err != nil {
			return nil, err
		}

		game, relations := input.Body.model(0)
		if err := repo.Create(ctx, game, relations); err != nil {
			return nil, apiError(err, "no game with that id")
		}
		return reloadGame(ctx, repo, game.ID)
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-game",
		Method:      http.MethodPut,
		Path:        "/api/games/{id}",
		Summary:     "Replace a game",
		Description: "Overwrites every field: anything left out of the body is cleared, and the relations are replaced by the ids sent.",
		Tags:        []string{"Games"},
		Errors:      []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *updateGameInput) (*gameOutput, error) {
		repo, err := library(ctx, db)
		if err != nil {
			return nil, err
		}

		id, err := resolveGame(ctx, repo, input.Ref)
		if err != nil {
			return nil, err
		}

		game, relations := input.Body.model(id)
		if err := repo.Update(ctx, game, relations); err != nil {
			return nil, apiError(err, "no game with that id")
		}
		return reloadGame(ctx, repo, id)
	})

	huma.Register(api, huma.Operation{
		OperationID:   "delete-game",
		Method:        http.MethodDelete,
		Path:          "/api/games/{id}",
		Summary:       "Delete a game",
		Tags:          []string{"Games"},
		DefaultStatus: http.StatusNoContent,
		Errors:        []int{http.StatusUnauthorized, http.StatusNotFound},
	}, func(ctx context.Context, input *gameIDInput) (*struct{}, error) {
		repo, err := library(ctx, db)
		if err != nil {
			return nil, err
		}

		id, err := resolveGame(ctx, repo, input.Ref)
		if err != nil {
			return nil, err
		}

		if err := repo.Delete(ctx, id); err != nil {
			return nil, apiError(err, "no game with that id")
		}
		return nil, nil
	})
}

// reloadGame reads a game back after a write, so that created and updated
// games come back in exactly the shape a GET would return: with the platform
// and the relations loaded, and with the timestamps the database assigned.
func reloadGame(ctx context.Context, repo *repository.GameRepository, id uint64) (*gameOutput, error) {
	game, err := repo.Get(ctx, id)
	if err != nil {
		return nil, apiError(err, "no game with that id")
	}
	return &gameOutput{Body: game}, nil
}
