// Package igdb is a small client for the IGDB API (api-docs.igdb.com), which
// the game form's Identify button looks games up with.
//
// IGDB authenticates through Twitch: a Twitch application's client id and
// secret are exchanged for an app access token, which every request then
// carries. The client does that exchange itself, keeps the token for as long
// as it lasts and fetches a new one when it runs out, so a deployment only
// ever configures the id and the secret.
package igdb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mperezfo/gamelog/internal/country"
)

const (
	defaultTokenURL = "https://id.twitch.tv/oauth2/token"
	defaultAPIURL   = "https://api.igdb.com/v4"

	// coverURL is where IGDB serves a cover by its image id. t_cover_small is
	// 90x128: enough to tell two candidates apart, which is all it is for.
	coverURL = "https://images.igdb.com/igdb/image/upload/t_cover_small/%s.jpg"

	// imageURL is where IGDB serves an image by size and image id, for the
	// image search: t_original for the image itself, and a size for its
	// thumbnail that suits its kind (see Images).
	imageURL = "https://images.igdb.com/igdb/image/upload/%s/%s.jpg"

	// searchLimit is how many games a search returns. A title rarely needs
	// more than a handful to find the right one among remakes and remasters.
	searchLimit = 10

	// tokenMargin renews a token this long before it expires, so that one
	// is never sent in the last seconds of its life.
	tokenMargin = time.Hour

	// maxResponseSize caps what is read from IGDB or Twitch.
	maxResponseSize = 4 << 20 // 4 MiB
)

// errUnauthorized is a 401 from the API: the token was revoked or expired
// early, and is worth renewing once.
var errUnauthorized = errors.New("igdb: unauthorized")

// Company is a developer or publisher as IGDB lists it.
type Company struct {
	ID   uint64
	Name string
	// Country is where it is from, as an ISO 3166-1 two-letter code, or
	// empty when IGDB does not say.
	Country string
}

// Platform is a system as IGDB lists it.
type Platform struct {
	ID   uint64
	Name string
	// Abbreviation is IGDB's short name ("PS5" for "PlayStation 5"), or empty
	// when it has none.
	Abbreviation string
}

// Game is one search result.
type Game struct {
	ID   uint64
	Name string
	// ReleaseDate is IGDB's first release date across every platform, at
	// midnight UTC. Nil when IGDB does not know it.
	ReleaseDate *time.Time
	Platforms   []Platform
	Developers  []Company
	Publishers  []Company
	// CoverURL is a small cover hosted by IGDB, to tell candidates apart.
	// Nil when the game has none.
	CoverURL *string
}

// Client talks to IGDB with one Twitch application's credentials. It is safe
// for concurrent use.
type Client struct {
	clientID     string
	clientSecret string
	http         *http.Client
	tokenURL     string
	apiURL       string
	now          func() time.Time

	mu      sync.Mutex
	token   string
	expires time.Time
}

// New builds a client for the given Twitch application.
func New(clientID, clientSecret string) *Client {
	return &Client{
		clientID:     clientID,
		clientSecret: clientSecret,
		http:         &http.Client{Timeout: 10 * time.Second},
		tokenURL:     defaultTokenURL,
		apiURL:       defaultAPIURL,
		now:          time.Now,
	}
}

// searchFields are the fields of a game that a search asks for.
const searchFields = "name,first_release_date,platforms.name,platforms.abbreviation,cover.image_id," +
	"involved_companies.company.name,involved_companies.company.country," +
	"involved_companies.developer,involved_companies.publisher"

// Search looks games up by title, most relevant first. Editions of a game
// (a "Game of the Year Edition" and the like) are left out, so that the
// results are the games themselves.
//
// IGDB's search ignores common words ("the", "against") and ranks games by
// what is left, so a title made mostly of them can fall far down its results:
// "Against the Storm" is a search for "storm", and comes 14th. Games named
// exactly the title, ignoring case, are looked up on their own and come first.
func (c *Client) Search(ctx context.Context, title string) ([]Game, error) {
	var exact []apiGame
	query := fmt.Sprintf(`fields %s; where name ~ "%s" & version_parent = null; limit %d;`,
		searchFields, escape(title), searchLimit)
	if err := c.query(ctx, "games", query, &exact); err != nil {
		return nil, err
	}

	var searched []apiGame
	query = fmt.Sprintf(`search "%s"; fields %s; where version_parent = null; limit %d;`,
		escape(title), searchFields, searchLimit)
	if err := c.query(ctx, "games", query, &searched); err != nil {
		return nil, err
	}

	games := make([]Game, 0, searchLimit)
	seen := map[uint64]bool{}
	for _, result := range slices.Concat(exact, searched) {
		if len(games) == searchLimit {
			break
		}
		if seen[result.ID] {
			continue
		}
		seen[result.ID] = true
		games = append(games, result.game())
	}
	return games, nil
}

// Kinds of image a game has on IGDB.
const (
	// KindCover is the game's box art.
	KindCover = "cover"
	// KindArtwork is official art of the game, most often landscape.
	KindArtwork = "artwork"
)

// Image is one image of a game.
type Image struct {
	// URL is the image at full size, and ThumbURL a smaller copy of it.
	URL      string
	ThumbURL string
	Width    int
	Height   int
	// Kind is KindCover or KindArtwork.
	Kind string
}

// Images returns the cover and the artworks of a game, the cover first.
func (c *Client) Images(ctx context.Context, gameID uint64) ([]Image, error) {
	query := fmt.Sprintf(
		"fields cover.image_id,cover.width,cover.height,"+
			"artworks.image_id,artworks.width,artworks.height; where id = %d;",
		gameID,
	)
	var results []struct {
		Cover    *apiImage  `json:"cover"`
		Artworks []apiImage `json:"artworks"`
	}
	if err := c.query(ctx, "games", query, &results); err != nil {
		return nil, err
	}
	if len(results) == 0 {
		return nil, ErrNotFound
	}

	result := results[0]
	images := make([]Image, 0, len(result.Artworks)+1)
	if result.Cover != nil && result.Cover.ImageID != "" {
		// t_cover_big_2x is 528x748: a cover as large as the search shows
		// one, sharp on a high-density screen.
		images = append(images, result.Cover.image(KindCover, "t_cover_big_2x"))
	}
	for _, artwork := range result.Artworks {
		if artwork.ImageID == "" {
			continue
		}
		// t_screenshot_big is 889x500, landscape like most artworks, which
		// the search shows twice as wide as a cover.
		images = append(images, artwork.image(KindArtwork, "t_screenshot_big"))
	}
	return images, nil
}

// maxByID caps one lookup of records by id, which IGDB answers in a single
// page of at most this many results.
const maxByID = 50

// Companies returns the companies with the given ids, in the order asked
// for. An id IGDB does not know is left out.
func (c *Client) Companies(ctx context.Context, ids []uint64) ([]Company, error) {
	results, err := byID[apiCompany](ctx, c, "companies", "name,country", ids)
	if err != nil {
		return nil, err
	}
	companies := make([]Company, 0, len(results))
	for _, result := range results {
		companies = append(companies, result.company())
	}
	return companies, nil
}

// Platforms returns the platforms with the given ids, in the order asked
// for. An id IGDB does not know is left out.
func (c *Client) Platforms(ctx context.Context, ids []uint64) ([]Platform, error) {
	results, err := byID[apiPlatform](ctx, c, "platforms", "name,abbreviation", ids)
	if err != nil {
		return nil, err
	}
	platforms := make([]Platform, 0, len(results))
	for _, result := range results {
		platforms = append(platforms, result.platform())
	}
	return platforms, nil
}

// identified is a record of the API, which byID reads by its id.
type identified interface {
	apiCompany | apiPlatform
	id() uint64
}

// byID reads the records of one endpoint with the given ids, at most maxByID
// of them, in the order asked for. An id IGDB does not know is left out.
func byID[R identified](ctx context.Context, c *Client, endpoint, fields string, ids []uint64) ([]R, error) {
	if len(ids) == 0 {
		return []R{}, nil
	}
	if len(ids) > maxByID {
		ids = ids[:maxByID]
	}

	list := make([]string, 0, len(ids))
	for _, id := range ids {
		list = append(list, strconv.FormatUint(id, 10))
	}
	var results []R
	query := fmt.Sprintf("fields %s; where id = (%s); limit %d;", fields, strings.Join(list, ","), maxByID)
	if err := c.query(ctx, endpoint, query, &results); err != nil {
		return nil, err
	}

	found := make(map[uint64]R, len(results))
	for _, result := range results {
		found[result.id()] = result
	}
	ordered := make([]R, 0, len(ids))
	for _, id := range ids {
		if result, ok := found[id]; ok {
			ordered = append(ordered, result)
		}
	}
	return ordered, nil
}

// ErrNotFound is returned when IGDB has no record with the id asked for.
var ErrNotFound = errors.New("igdb: not found")

// CompanyURL returns the page of a company on igdb.com.
func (c *Client) CompanyURL(ctx context.Context, id uint64) (string, error) {
	return c.pageURL(ctx, "companies", "https://www.igdb.com/companies/", id)
}

// PlatformURL returns the page of a platform on igdb.com.
func (c *Client) PlatformURL(ctx context.Context, id uint64) (string, error) {
	return c.pageURL(ctx, "platforms", "https://www.igdb.com/platforms/", id)
}

// GameURL returns the page of a game on igdb.com.
func (c *Client) GameURL(ctx context.Context, id uint64) (string, error) {
	return c.pageURL(ctx, "games", "https://www.igdb.com/games/", id)
}

// pageURL returns the page on igdb.com of the record with the given id on
// one endpoint. Pages are addressed by a slug rather than the id, so the id
// alone is not enough to link to one.
//
// prefix is where every page of that endpoint lives. A URL from the API
// outside it is not followed: redirecting a browser is only safe to a place
// known in advance.
func (c *Client) pageURL(ctx context.Context, endpoint, prefix string, id uint64) (string, error) {
	var results []struct {
		URL string `json:"url"`
	}
	if err := c.query(ctx, endpoint, fmt.Sprintf("fields url; where id = %d;", id), &results); err != nil {
		return "", err
	}
	if len(results) == 0 {
		return "", ErrNotFound
	}
	if !strings.HasPrefix(results[0].URL, prefix) {
		return "", fmt.Errorf("igdb: %s %d has an unexpected URL %q", endpoint, id, results[0].URL)
	}
	return results[0].URL, nil
}

// escape makes title safe to put between the double quotes of an Apicalypse
// string.
func escape(title string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(title)
}

// query runs an Apicalypse query against one endpoint, renewing the token
// once if the API turns it down.
func (c *Client) query(ctx context.Context, endpoint, body string, target any) error {
	err := c.queryOnce(ctx, endpoint, body, target)
	if errors.Is(err, errUnauthorized) {
		c.forgetToken()
		err = c.queryOnce(ctx, endpoint, body, target)
	}
	return err
}

func (c *Client) queryOnce(ctx context.Context, endpoint, body string, target any) error {
	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.apiURL+"/"+endpoint, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Client-ID", c.clientID)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "text/plain")

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("igdb: querying %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return errUnauthorized
	}
	return decodeResponse(resp, "igdb: querying "+endpoint, target)
}

// accessToken returns a token that is good for a while yet, fetching a new
// one when there is none. The lock is held through the fetch, so concurrent
// requests wait for one exchange rather than each starting their own.
func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" && c.now().Add(tokenMargin).Before(c.expires) {
		return c.token, nil
	}

	form := url.Values{
		"client_id":     {c.clientID},
		"client_secret": {c.clientSecret},
		"grant_type":    {"client_credentials"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("igdb: fetching an access token: %w", err)
	}
	defer resp.Body.Close()

	var token struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := decodeResponse(resp, "igdb: fetching an access token", &token); err != nil {
		return "", err
	}
	if token.AccessToken == "" {
		return "", errors.New("igdb: fetching an access token: the response carried none")
	}

	c.token = token.AccessToken
	c.expires = c.now().Add(time.Duration(token.ExpiresIn) * time.Second)
	return c.token, nil
}

// forgetToken drops the token, so that the next request fetches a new one.
func (c *Client) forgetToken() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = ""
}

// decodeResponse reads a JSON response into target, or turns a failed one
// into an error carrying the start of its body, for the log.
func decodeResponse(resp *http.Response, what string, target any) error {
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize))
	if err != nil {
		return fmt.Errorf("%s: reading the response: %w", what, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		const excerpt = 200
		if len(data) > excerpt {
			data = data[:excerpt]
		}
		return fmt.Errorf("%s: status %d: %s", what, resp.StatusCode, data)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("%s: decoding the response: %w", what, err)
	}
	return nil
}

// apiCompany is a company as the API returns it.
type apiCompany struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
	// Country is ISO 3166-1's numeric code (724 for Spain), or 0.
	Country int `json:"country"`
}

func (c apiCompany) id() uint64 { return c.ID }

func (c apiCompany) company() Company {
	code, _ := country.FromNumeric(c.Country)
	return Company{ID: c.ID, Name: c.Name, Country: code}
}

// apiPlatform is a platform as the API returns it.
type apiPlatform struct {
	ID           uint64 `json:"id"`
	Name         string `json:"name"`
	Abbreviation string `json:"abbreviation"`
}

func (p apiPlatform) id() uint64 { return p.ID }

func (p apiPlatform) platform() Platform {
	return Platform{ID: p.ID, Name: p.Name, Abbreviation: strings.TrimSpace(p.Abbreviation)}
}

// apiImage is a cover or an artwork as the API returns it.
type apiImage struct {
	ImageID string `json:"image_id"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
}

func (i apiImage) image(kind, thumbSize string) Image {
	return Image{
		URL:      fmt.Sprintf(imageURL, "t_original", i.ImageID),
		ThumbURL: fmt.Sprintf(imageURL, thumbSize, i.ImageID),
		Width:    i.Width,
		Height:   i.Height,
		Kind:     kind,
	}
}

// apiGame is a game as the search queries above return it.
type apiGame struct {
	ID               uint64        `json:"id"`
	Name             string        `json:"name"`
	FirstReleaseDate *int64        `json:"first_release_date"`
	Platforms        []apiPlatform `json:"platforms"`
	Cover            *struct {
		ImageID string `json:"image_id"`
	} `json:"cover"`
	InvolvedCompanies []struct {
		Company   apiCompany `json:"company"`
		Developer bool       `json:"developer"`
		Publisher bool       `json:"publisher"`
	} `json:"involved_companies"`
}

// game turns a result into the client's own type.
func (g apiGame) game() Game {
	game := Game{
		ID:         g.ID,
		Name:       g.Name,
		Platforms:  make([]Platform, 0, len(g.Platforms)),
		Developers: []Company{},
		Publishers: []Company{},
	}

	if g.FirstReleaseDate != nil {
		// A Unix timestamp, at whatever time of day IGDB stored it. Only the
		// date in UTC means anything.
		released := time.Unix(*g.FirstReleaseDate, 0).UTC().Truncate(24 * time.Hour)
		game.ReleaseDate = &released
	}
	for _, platform := range g.Platforms {
		if platform.ID == 0 || platform.Name == "" {
			continue
		}
		game.Platforms = append(game.Platforms, platform.platform())
	}
	if g.Cover != nil && g.Cover.ImageID != "" {
		cover := fmt.Sprintf(coverURL, g.Cover.ImageID)
		game.CoverURL = &cover
	}

	// A company can be listed more than once for the same game (once per
	// port, say), and should only be offered once per role.
	seenDevelopers := map[uint64]bool{}
	seenPublishers := map[uint64]bool{}
	for _, involved := range g.InvolvedCompanies {
		company := involved.Company.company()
		if company.ID == 0 || company.Name == "" {
			continue
		}
		if involved.Developer && !seenDevelopers[company.ID] {
			seenDevelopers[company.ID] = true
			game.Developers = append(game.Developers, company)
		}
		if involved.Publisher && !seenPublishers[company.ID] {
			seenPublishers[company.ID] = true
			game.Publishers = append(game.Publishers, company)
		}
	}

	return game
}
