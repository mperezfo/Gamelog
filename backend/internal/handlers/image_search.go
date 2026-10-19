package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/steamgriddb"
)

// SteamGridDB is what the image search needs from SteamGridDB.
// *steamgriddb.Client is the one in use; tests pass a fake.
type SteamGridDB interface {
	Search(ctx context.Context, title string) ([]steamgriddb.Game, error)
	Images(ctx context.Context, gameID uint64) ([]steamgriddb.Image, error)
}

type searchGameImagesInput struct {
	Source string `query:"source" required:"true" enum:"igdb,steamgriddb" doc:"Where to search, one of the capabilities' image_sources." example:"igdb"`
	Title  string `query:"title" maxLength:"255" doc:"Title to look the game up by. Its matches are listed, for a client to offer the others, and the first one's images are returned unless game_id says otherwise. Required without game_id." example:"Resident Evil 4"`
	GameID uint64 `query:"game_id" doc:"The source's id for the game whose images to return, such as a game's igdb_id or one of the matches of an earlier search. Left out, the first match for the title." example:"26192"`
}

type imageSearchGame struct {
	ID          uint64     `json:"id" doc:"The source's id for the game, to search again with as game_id." example:"26192"`
	Name        string     `json:"name" doc:"Its title on the source." example:"Resident Evil 4"`
	ReleaseDate *time.Time `json:"release_date" doc:"Its release date on the source, RFC 3339 at midnight UTC, to tell remakes apart. Null when the source does not know it." example:"2023-03-24T00:00:00Z"`
}

type gameImage struct {
	URL      string `json:"url" doc:"The image at full size, hosted by the source. Not meant to be stored as it is: import-image copies it into the library." example:"https://images.igdb.com/igdb/image/upload/t_original/co6bo0.jpg"`
	ThumbURL string `json:"thumb_url" doc:"A smaller copy, hosted by the source, to choose from." example:"https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co6bo0.jpg"`
	Width    int    `json:"width" doc:"Width of the full-size image in pixels, 0 when the source does not say." example:"1200"`
	Height   int    `json:"height" doc:"Its height in pixels, 0 when the source does not say." example:"1600"`
	Kind     string `json:"kind" enum:"cover,artwork,grid,hero" doc:"What the image is: IGDB's box art (cover) or other official art (artwork), or SteamGridDB's library art (grid, portrait or landscape) or page banner (hero)." example:"cover"`
}

type searchGameImagesOutput struct {
	Body struct {
		Games  []imageSearchGame `json:"games" doc:"Games the title may refer to, most relevant first. Empty without a title."`
		GameID *uint64           `json:"game_id" doc:"The game the images are of. Null when the title matched nothing." example:"26192"`
		Images []gameImage       `json:"images" doc:"Its images, the closest to a cover first."`
	}
}

// imageSearchSource is one place cover images are searched for, behind the
// same two calls whatever its own API looks like.
type imageSearchSource struct {
	// id is how the API names it, in a request and in the capabilities.
	id string
	// name is how an error names it.
	name   string
	search func(ctx context.Context, title string) ([]imageSearchGame, error)
	images func(ctx context.Context, gameID uint64) ([]gameImage, error)
}

// imageSearchSources lists the sources the deployment is configured for, in
// the order a client offers them: IGDB first, as the source games are
// identified with.
func imageSearchSources(sources Sources) []imageSearchSource {
	var out []imageSearchSource
	if source := sources.IGDB; source != nil {
		out = append(out, newImageSearchSource("igdb", "IGDB", source.Search, source.Images,
			func(game igdb.Game) imageSearchGame {
				return imageSearchGame{ID: game.ID, Name: game.Name, ReleaseDate: game.ReleaseDate}
			}))
	}
	if source := sources.SteamGridDB; source != nil {
		out = append(out, newImageSearchSource("steamgriddb", "SteamGridDB", source.Search, source.Images,
			func(game steamgriddb.Game) imageSearchGame {
				return imageSearchGame{ID: game.ID, Name: game.Name, ReleaseDate: game.ReleaseDate}
			}))
	}
	return out
}

// newImageSearchSource adapts one service's own search and images, with game
// turning one of its games into the API's.
func newImageSearchSource[G any, I igdb.Image | steamgriddb.Image](
	id, name string,
	search func(context.Context, string) ([]G, error),
	images func(context.Context, uint64) ([]I, error),
	game func(G) imageSearchGame,
) imageSearchSource {
	return imageSearchSource{
		id:   id,
		name: name,
		search: func(ctx context.Context, title string) ([]imageSearchGame, error) {
			results, err := search(ctx, title)
			if err != nil {
				return nil, err
			}
			games := make([]imageSearchGame, 0, len(results))
			for _, result := range results {
				games = append(games, game(result))
			}
			return games, nil
		},
		images: func(ctx context.Context, gameID uint64) ([]gameImage, error) {
			results, err := images(ctx, gameID)
			if err != nil {
				return nil, err
			}
			out := make([]gameImage, 0, len(results))
			for _, result := range results {
				// Both services' images have the fields of the API's.
				out = append(out, gameImage(result))
			}
			return out, nil
		},
	}
}

// registerImageSearch registers the search for cover images, behind the
// cover's Search image button. Picking one goes through import-image, which
// copies it into the library.
func registerImageSearch(api huma.API, sources []imageSearchSource) {
	huma.Register(api, huma.Operation{
		OperationID: "search-game-images",
		Method:      http.MethodGet,
		Path:        "/api/metadata/images",
		Summary:     "Search a game's images",
		Description: "Looks a game up on IGDB or SteamGridDB and returns its covers and other art, " +
			"with the other games the title may refer to so that a client can switch to one of them. " +
			"See the capabilities' image_sources for which of the two this deployment is configured for.",
		Tags: []string{"Metadata"},
		Errors: []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusUnprocessableEntity,
			http.StatusFailedDependency, http.StatusNotImplemented},
	}, func(ctx context.Context, input *searchGameImagesInput) (*searchGameImagesOutput, error) {
		var source *imageSearchSource
		for i := range sources {
			if sources[i].id == input.Source {
				source = &sources[i]
			}
		}
		if source == nil {
			name := map[string]string{"igdb": "IGDB", "steamgriddb": "SteamGridDB"}[input.Source]
			return nil, errSourceNotConfigured(name)
		}

		title := strings.TrimSpace(input.Title)
		if title == "" && input.GameID == 0 {
			return nil, huma.Error422UnprocessableEntity("a title or a game_id is required")
		}

		// One timeout for the whole search, as the frontend waits for the
		// whole of it (see searchTimeout).
		searchCtx, cancel := context.WithTimeout(ctx, searchTimeout)
		defer cancel()

		out := &searchGameImagesOutput{}
		out.Body.Games = []imageSearchGame{}
		out.Body.Images = []gameImage{}
		if title != "" {
			games, err := source.search(searchCtx, title)
			if err != nil {
				slog.Warn("searching "+source.name+" for images failed", "error", err)
				return nil, errSourceFailed(source.name)
			}
			out.Body.Games = games
		}

		gameID := input.GameID
		if gameID == 0 {
			if len(out.Body.Games) == 0 {
				return out, nil
			}
			gameID = out.Body.Games[0].ID
		}

		images, err := source.images(searchCtx, gameID)
		if errors.Is(err, igdb.ErrNotFound) {
			return nil, huma.Error404NotFound(source.name + " has no game with that id")
		}
		if err != nil {
			slog.Warn("reading a game's images on "+source.name+" failed", "id", gameID, "error", err)
			return nil, errSourceFailed(source.name)
		}
		out.Body.GameID = &gameID
		out.Body.Images = images
		return out, nil
	})
}
