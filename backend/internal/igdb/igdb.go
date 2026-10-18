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
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultTokenURL = "https://id.twitch.tv/oauth2/token"
	defaultAPIURL   = "https://api.igdb.com/v4"

	// coverURL is where IGDB serves a cover by its image id. t_cover_small is
	// 90x128: enough to tell two candidates apart, which is all it is for.
	coverURL = "https://images.igdb.com/igdb/image/upload/t_cover_small/%s.jpg"

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
}

// Game is one search result.
type Game struct {
	ID   uint64
	Name string
	// ReleaseDate is IGDB's first release date across every platform, at
	// midnight UTC. Nil when IGDB does not know it.
	ReleaseDate *time.Time
	Platforms   []string
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

// Search looks games up by title, most relevant first. Editions of a game
// (a "Game of the Year Edition" and the like) are left out, so that the
// results are the games themselves.
func (c *Client) Search(ctx context.Context, title string) ([]Game, error) {
	query := fmt.Sprintf(
		`search "%s"; `+
			`fields name,first_release_date,platforms.name,cover.image_id,`+
			`involved_companies.company.name,involved_companies.developer,involved_companies.publisher; `+
			`where version_parent = null; limit %d;`,
		escape(title), searchLimit,
	)

	var results []apiGame
	if err := c.query(ctx, "games", query, &results); err != nil {
		return nil, err
	}

	games := make([]Game, 0, len(results))
	for _, result := range results {
		games = append(games, result.game())
	}
	return games, nil
}

// maxCompanies caps one lookup of companies by id, which IGDB answers in a
// single page of at most this many results.
const maxCompanies = 50

// Companies returns the companies with the given ids, in the order asked
// for. An id IGDB does not know is left out.
func (c *Client) Companies(ctx context.Context, ids []uint64) ([]Company, error) {
	if len(ids) == 0 {
		return []Company{}, nil
	}
	if len(ids) > maxCompanies {
		ids = ids[:maxCompanies]
	}

	list := make([]string, 0, len(ids))
	for _, id := range ids {
		list = append(list, strconv.FormatUint(id, 10))
	}
	var results []struct {
		ID   uint64 `json:"id"`
		Name string `json:"name"`
	}
	query := fmt.Sprintf("fields name; where id = (%s); limit %d;", strings.Join(list, ","), maxCompanies)
	if err := c.query(ctx, "companies", query, &results); err != nil {
		return nil, err
	}

	names := make(map[uint64]string, len(results))
	for _, result := range results {
		names[result.ID] = result.Name
	}
	companies := make([]Company, 0, len(ids))
	for _, id := range ids {
		if name, ok := names[id]; ok {
			companies = append(companies, Company{ID: id, Name: name})
		}
	}
	return companies, nil
}

// ErrNotFound is returned when IGDB has no record with the id asked for.
var ErrNotFound = errors.New("igdb: not found")

// companyPagePrefix is where every company page on IGDB lives. A URL from
// the API outside it is not followed: redirecting a browser is only safe to
// a place known in advance.
const companyPagePrefix = "https://www.igdb.com/companies/"

// CompanyURL returns the page of a company on igdb.com. Pages are addressed
// by a slug rather than the id, so the id alone is not enough to link to one.
func (c *Client) CompanyURL(ctx context.Context, id uint64) (string, error) {
	var results []struct {
		URL string `json:"url"`
	}
	if err := c.query(ctx, "companies", fmt.Sprintf("fields url; where id = %d;", id), &results); err != nil {
		return "", err
	}
	if len(results) == 0 {
		return "", ErrNotFound
	}
	if !strings.HasPrefix(results[0].URL, companyPagePrefix) {
		return "", fmt.Errorf("igdb: company %d has an unexpected URL %q", id, results[0].URL)
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

// apiGame is a game as the search query above returns it.
type apiGame struct {
	ID               uint64 `json:"id"`
	Name             string `json:"name"`
	FirstReleaseDate *int64 `json:"first_release_date"`
	Platforms        []struct {
		Name string `json:"name"`
	} `json:"platforms"`
	Cover *struct {
		ImageID string `json:"image_id"`
	} `json:"cover"`
	InvolvedCompanies []struct {
		Company struct {
			ID   uint64 `json:"id"`
			Name string `json:"name"`
		} `json:"company"`
		Developer bool `json:"developer"`
		Publisher bool `json:"publisher"`
	} `json:"involved_companies"`
}

// game turns a result into the client's own type.
func (g apiGame) game() Game {
	game := Game{
		ID:         g.ID,
		Name:       g.Name,
		Platforms:  make([]string, 0, len(g.Platforms)),
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
		game.Platforms = append(game.Platforms, platform.Name)
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
		company := Company{ID: involved.Company.ID, Name: involved.Company.Name}
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
