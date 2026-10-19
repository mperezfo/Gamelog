// Package steamgriddb is a small client for the SteamGridDB API
// (steamgriddb.com/api/v2), which the cover image search looks images up
// with alongside IGDB.
//
// SteamGridDB authenticates with a single API key, sent as a bearer token on
// every request, so unlike IGDB there is no token to exchange or renew.
package steamgriddb

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAPIURL = "https://www.steamgriddb.com/api/v2"

	// searchLimit is how many games a search returns, the same as IGDB's.
	searchLimit = 10

	// maxResponseSize caps what is read from the API.
	maxResponseSize = 4 << 20 // 4 MiB
)

// Kinds of image a game has on SteamGridDB.
const (
	// KindGrid is the art a launcher shows in its library grid: portrait
	// box art, or a landscape banner.
	KindGrid = "grid"
	// KindHero is the wide banner a launcher shows at the top of a game's
	// page.
	KindHero = "hero"
)

// Game is one search result.
type Game struct {
	ID   uint64
	Name string
	// ReleaseDate is the date SteamGridDB has for the game, at midnight UTC.
	// Nil when it has none.
	ReleaseDate *time.Time
}

// Image is one image of a game.
type Image struct {
	// URL is the image at full size, and ThumbURL a smaller copy of it.
	URL      string
	ThumbURL string
	Width    int
	Height   int
	// Kind is KindGrid or KindHero.
	Kind string
}

// Client talks to SteamGridDB with one API key. It is safe for concurrent
// use.
type Client struct {
	apiKey string
	http   *http.Client
	apiURL string
}

// New builds a client for the given API key.
func New(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		http:   &http.Client{Timeout: 10 * time.Second},
		apiURL: defaultAPIURL,
	}
}

// Search looks games up by title, most relevant first.
func (c *Client) Search(ctx context.Context, title string) ([]Game, error) {
	var results []apiGame
	if err := c.get(ctx, "/search/autocomplete/"+url.PathEscape(title), nil, &results); err != nil {
		return nil, err
	}
	if len(results) > searchLimit {
		results = results[:searchLimit]
	}

	games := make([]Game, 0, len(results))
	for _, result := range results {
		game := Game{ID: result.ID, Name: result.Name}
		if result.ReleaseDate != nil && *result.ReleaseDate > 0 {
			released := time.Unix(*result.ReleaseDate, 0).UTC().Truncate(24 * time.Hour)
			game.ReleaseDate = &released
		}
		games = append(games, game)
	}
	return games, nil
}

// Images returns the grids and heroes of a game: portrait grids first, as
// they are the closest to a cover, then landscape ones, then heroes. Within
// each, the order is SteamGridDB's own, by score. Animated images and those
// marked NSFW are left out.
func (c *Client) Images(ctx context.Context, gameID uint64) ([]Image, error) {
	// Static only: a cover is a still image, and an animated one would only
	// keep its first frame.
	query := url.Values{"types": {"static"}, "nsfw": {"false"}}
	id := strconv.FormatUint(gameID, 10)

	var grids, heroes []apiImage
	if err := c.get(ctx, "/grids/game/"+id, query, &grids); err != nil {
		return nil, err
	}
	if err := c.get(ctx, "/heroes/game/"+id, query, &heroes); err != nil {
		return nil, err
	}

	// Stable, so that the score order holds among the grids of one shape.
	slices.SortStableFunc(grids, func(a, b apiImage) int { return cmp.Compare(a.shapeRank(), b.shapeRank()) })

	images := make([]Image, 0, len(grids)+len(heroes))
	for _, grid := range grids {
		if grid.URL == "" {
			continue
		}
		images = append(images, grid.image(KindGrid))
	}
	for _, hero := range heroes {
		if hero.URL == "" {
			continue
		}
		images = append(images, hero.image(KindHero))
	}
	return images, nil
}

// get calls one endpoint of the API and reads its data into target.
func (c *Client) get(ctx context.Context, path string, query url.Values, target any) error {
	endpoint := c.apiURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("steamgriddb: requesting %s: %w", path, err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return fmt.Errorf("steamgriddb: requesting %s: reading the response: %w", path, err)
	}
	// A game with no images of a kind is a 404 on some endpoints, which is
	// no failure: there is simply nothing to show.
	if resp.StatusCode == http.StatusNotFound {
		return json.Unmarshal([]byte("[]"), target)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		const excerpt = 200
		if len(data) > excerpt {
			data = data[:excerpt]
		}
		return fmt.Errorf("steamgriddb: requesting %s: status %d: %s", path, resp.StatusCode, data)
	}

	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Errors  []string        `json:"errors"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("steamgriddb: requesting %s: decoding the response: %w", path, err)
	}
	if !envelope.Success {
		return fmt.Errorf("steamgriddb: requesting %s: %s", path, strings.Join(envelope.Errors, ", "))
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		envelope.Data = []byte("[]")
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return fmt.Errorf("steamgriddb: requesting %s: decoding the response: %w", path, err)
	}
	return nil
}

// apiGame is a game as the search returns it.
type apiGame struct {
	ID          uint64 `json:"id"`
	Name        string `json:"name"`
	ReleaseDate *int64 `json:"release_date"`
}

// apiImage is a grid or a hero as the API returns it.
type apiImage struct {
	URL    string `json:"url"`
	Thumb  string `json:"thumb"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// shapeRank puts portrait images before the rest.
func (i apiImage) shapeRank() int {
	if i.Height > i.Width {
		return 0
	}
	return 1
}

func (i apiImage) image(kind string) Image {
	thumb := i.Thumb
	if thumb == "" {
		thumb = i.URL
	}
	return Image{URL: i.URL, ThumbURL: thumb, Width: i.Width, Height: i.Height, Kind: kind}
}
