package handlers

import (
	"cmp"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/namematch"
	"github.com/mperezfo/gamelog/internal/repository"
)

// IGDB is what the metadata operations need from IGDB. *igdb.Client is the
// one in use; tests pass a fake rather than a whole IGDB.
type IGDB interface {
	Search(ctx context.Context, title string) ([]igdb.Game, error)
	CompanyURL(ctx context.Context, id uint64) (string, error)
	GameURL(ctx context.Context, id uint64) (string, error)
	PlatformURL(ctx context.Context, id uint64) (string, error)
	Companies(ctx context.Context, ids []uint64) ([]igdb.Company, error)
	Platforms(ctx context.Context, ids []uint64) ([]igdb.Platform, error)
	Images(ctx context.Context, gameID uint64) ([]igdb.Image, error)
}

type metadataCapabilitiesOutput struct {
	Body struct {
		Identify bool `json:"identify" doc:"Whether games can be looked up on IGDB, which needs the deployment to be configured with IGDB credentials."`
		// Never null: a client checks its length, not its presence.
		ImageSources []string `json:"image_sources" enum:"igdb,steamgriddb" doc:"Where cover images can be searched for (see search-game-images), in the order to offer them. Empty when the deployment is configured for neither."`
	}
}

type searchGameMetadataInput struct {
	Title string `query:"title" required:"true" minLength:"1" maxLength:"255" doc:"Title to look up." example:"Resident Evil 4"`
}

// matchReason documents how a company or platform was matched to a record of
// the library.
type matchReason string

const (
	// matchLinked is a record already linked to the IGDB record: no guess.
	matchLinked matchReason = "linked"
)

// matchTarget is the record of the library a company or platform is likely
// to be.
type matchTarget struct {
	ID     uint64      `json:"id" doc:"Id of the developer, publisher or platform." example:"3"`
	Name   string      `json:"name" doc:"Its name." example:"Sony"`
	Reason matchReason `json:"reason" enum:"linked,name,normalized,prefix" doc:"How it was found: linked to this IGDB record already, the same name ignoring case and accents, the same name without company suffixes and generic words, or one name starting with the other (companies only). Only linked is certain; the rest are suggestions."`
}

// companyMatch is a developer or publisher of a candidate, with the record of
// the library it most likely is.
type companyMatch struct {
	IGDBCompanyID uint64       `json:"igdb_company_id" doc:"IGDB's id for the company." example:"10100"`
	Name          string       `json:"name" doc:"The company's name on IGDB." example:"Sony Interactive Entertainment"`
	Match         *matchTarget `json:"match" doc:"The developer or publisher of the library this company most likely is. Null when none is close enough to suggest."`
}

// platformMatch is a platform of a candidate, with the platform of the
// library it most likely is.
type platformMatch struct {
	IGDBPlatformID uint64       `json:"igdb_platform_id" doc:"IGDB's id for the platform." example:"167"`
	Name           string       `json:"name" doc:"The platform's name on IGDB." example:"PlayStation 5"`
	Abbreviation   string       `json:"abbreviation" doc:"IGDB's short name for it. Empty when IGDB has none." example:"PS5"`
	Match          *matchTarget `json:"match" doc:"The platform of the library this platform most likely is: of those linked to it, the one with the most games. Null when none is close enough to suggest."`
}

// gameCandidate is one IGDB game a title may refer to.
type gameCandidate struct {
	IGDBID uint64 `json:"igdb_id" doc:"IGDB's id for the game." example:"26192"`
	Name   string `json:"name" doc:"Title on IGDB." example:"Resident Evil 4"`
	// RFC 3339 at midnight UTC, the same shape as a game's release_date, so
	// that it can be written back as it is.
	ReleaseDate *time.Time      `json:"release_date" doc:"First release date across every platform, RFC 3339. Null when IGDB does not know it." example:"2023-03-24T00:00:00Z"`
	Platforms   []platformMatch `json:"platforms" doc:"Platforms it was released on, each with the platform of the library it most likely is."`
	CoverURL    *string         `json:"cover_url" doc:"Small cover hosted by IGDB, to tell candidates apart. Not meant to be stored: see the Images tag." example:"https://images.igdb.com/igdb/image/upload/t_cover_small/co6bo0.jpg"`
	Developers  []companyMatch  `json:"developers" doc:"Developers, each with the developer of the library it most likely is."`
	Publishers  []companyMatch  `json:"publishers" doc:"Publishers, each with the publisher of the library it most likely is."`
}

type listIGDBCompaniesInput struct {
	IDs []uint64 `query:"ids" required:"true" minItems:"1" maxItems:"50" doc:"IGDB's ids for the companies, comma-separated." example:"[70,1234]"`
}

type igdbCompany struct {
	ID   uint64 `json:"id" doc:"IGDB's id for the company." example:"70"`
	Name string `json:"name" doc:"Its name on IGDB." example:"Nintendo"`
}

type listIGDBCompaniesOutput struct {
	Body struct {
		Companies []igdbCompany `json:"companies" doc:"The companies, in the order asked for. An id IGDB does not know is left out."`
	}
}

type listIGDBPlatformsInput struct {
	IDs []uint64 `query:"ids" required:"true" minItems:"1" maxItems:"50" doc:"IGDB's ids for the platforms, comma-separated." example:"[6,167]"`
}

type igdbPlatform struct {
	ID           uint64 `json:"id" doc:"IGDB's id for the platform." example:"167"`
	Name         string `json:"name" doc:"Its name on IGDB." example:"PlayStation 5"`
	Abbreviation string `json:"abbreviation" doc:"Its short name on IGDB. Empty when IGDB has none." example:"PS5"`
}

type listIGDBPlatformsOutput struct {
	Body struct {
		Platforms []igdbPlatform `json:"platforms" doc:"The platforms, in the order asked for. An id IGDB does not know is left out."`
	}
}

type igdbPageInput struct {
	ID uint64 `path:"id" doc:"IGDB's id for the record." example:"37"`
}

type igdbPageOutput struct {
	Status   int
	Location string `header:"Location" doc:"The record's page on igdb.com."`
}

// igdbPage is one kind of IGDB record whose page the API redirects to.
type igdbPage struct {
	operationID string
	path        string
	// noun names the record in the summary and the errors.
	noun        string
	description string
	url         func(source IGDB, ctx context.Context, id uint64) (string, error)
}

// igdbPages are the IGDB records a library refers to by id, and so has to
// be able to open the page of.
var igdbPages = []igdbPage{
	{
		operationID: "open-igdb-company",
		path:        "/api/metadata/companies/{id}/page",
		noun:        "company",
		description: "Redirects to the page of an IGDB company, such as the one a developer or publisher " +
			"is linked to (see its igdb_company_ids).",
		url: IGDB.CompanyURL,
	},
	{
		operationID: "open-igdb-platform",
		path:        "/api/metadata/platforms/{id}/page",
		noun:        "platform",
		description: "Redirects to the page of an IGDB platform, such as one a platform is linked to " +
			"(see its igdb_platform_ids).",
		url: IGDB.PlatformURL,
	},
	{
		operationID: "open-igdb-game",
		path:        "/api/metadata/games/{id}/page",
		noun:        "game",
		description: "Redirects to the page of an IGDB game, such as the one a game was identified as " +
			"(see its igdb_id).",
		url: IGDB.GameURL,
	},
}

type searchGameMetadataOutput struct {
	Body struct {
		Candidates []gameCandidate `json:"candidates" doc:"Games the title may refer to, most relevant first."`
	}
}

// searchTimeout bounds a whole search, renewing the token included. It stays
// under the frontend's own wait for an answer (see its api/client.ts), past
// which the app takes the server itself for unreachable.
const searchTimeout = 8 * time.Second

// registerMetadata registers the lookups of game metadata on IGDB, behind the
// game form's Identify button, and the search for cover images (see
// registerImageSearch). A source is nil when the deployment has no credentials
// for it, in which case the capabilities say so and its operations answer 501.
//
// Neither failure answers 502 or 503, the statuses a gateway would use: the
// frontend reads those, from any endpoint, as the server being unreachable
// and switches to its offline mode, when only IGDB is.
func registerMetadata(api huma.API, db *gorm.DB, sources Sources) {
	source := sources.IGDB
	images := imageSearchSources(sources)

	huma.Register(api, huma.Operation{
		OperationID: "get-metadata-capabilities",
		Method:      http.MethodGet,
		Path:        "/api/metadata/capabilities",
		Summary:     "Which metadata lookups are available",
		Description: "Tells a client which of the metadata features this deployment is configured for, " +
			"so that it only offers the ones that work.",
		Tags:   []string{"Metadata"},
		Errors: []int{http.StatusUnauthorized},
	}, func(ctx context.Context, _ *struct{}) (*metadataCapabilitiesOutput, error) {
		out := &metadataCapabilitiesOutput{}
		out.Body.Identify = source != nil
		out.Body.ImageSources = make([]string, 0, len(images))
		for _, image := range images {
			out.Body.ImageSources = append(out.Body.ImageSources, image.id)
		}
		return out, nil
	})

	registerImageSearch(api, images)

	huma.Register(api, huma.Operation{
		OperationID: "search-game-metadata",
		Method:      http.MethodGet,
		Path:        "/api/metadata/games",
		Summary:     "Look a game up on IGDB",
		Description: "Searches IGDB for the games a title may refer to, with their release date, " +
			"platforms, developers and publishers. Each platform, developer and publisher comes with " +
			"the record of the caller's library it most likely is, to write back with a game's " +
			"developer_ids, new_developers and developer_links (and their publisher equivalents), " +
			"or platform_id, new_platform and platform_link.",
		Tags:   []string{"Metadata"},
		Errors: []int{http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusFailedDependency, http.StatusNotImplemented},
	}, func(ctx context.Context, input *searchGameMetadataInput) (*searchGameMetadataOutput, error) {
		if source == nil {
			return nil, errIGDBNotConfigured()
		}
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		searchCtx, cancel := context.WithTimeout(ctx, searchTimeout)
		defer cancel()
		results, err := source.Search(searchCtx, strings.TrimSpace(input.Title))
		if err != nil {
			slog.Warn("searching IGDB failed", "error", err)
			return nil, errIGDBFailed()
		}

		developers, err := newCompanyMatcher[models.Developer](ctx, db, user.ID)
		if err != nil {
			return nil, apiError(err, "")
		}
		publishers, err := newCompanyMatcher[models.Publisher](ctx, db, user.ID)
		if err != nil {
			return nil, apiError(err, "")
		}
		platforms, err := newPlatformMatcher(ctx, db, user.ID)
		if err != nil {
			return nil, apiError(err, "")
		}

		out := &searchGameMetadataOutput{}
		out.Body.Candidates = make([]gameCandidate, 0, len(results))
		for _, result := range results {
			out.Body.Candidates = append(out.Body.Candidates, gameCandidate{
				IGDBID:      result.ID,
				Name:        result.Name,
				ReleaseDate: result.ReleaseDate,
				Platforms:   platforms.matchAll(result.Platforms),
				CoverURL:    result.CoverURL,
				Developers:  developers.matchAll(result.Developers),
				Publishers:  publishers.matchAll(result.Publishers),
			})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-igdb-companies",
		Method:      http.MethodGet,
		Path:        "/api/metadata/companies",
		Summary:     "Name IGDB companies",
		Description: "Returns the names of IGDB companies by id, such as those a developer or publisher " +
			"is linked to (see its igdb_company_ids), which the library itself does not keep.",
		Tags: []string{"Metadata"},
		Errors: []int{http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusFailedDependency,
			http.StatusNotImplemented},
	}, func(ctx context.Context, input *listIGDBCompaniesInput) (*listIGDBCompaniesOutput, error) {
		if source == nil {
			return nil, errIGDBNotConfigured()
		}
		lookupCtx, cancel := context.WithTimeout(ctx, searchTimeout)
		defer cancel()
		companies, err := source.Companies(lookupCtx, input.IDs)
		if err != nil {
			slog.Warn("naming IGDB companies failed", "error", err)
			return nil, errIGDBFailed()
		}

		out := &listIGDBCompaniesOutput{}
		out.Body.Companies = make([]igdbCompany, 0, len(companies))
		for _, company := range companies {
			out.Body.Companies = append(out.Body.Companies, igdbCompany{ID: company.ID, Name: company.Name})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-igdb-platforms",
		Method:      http.MethodGet,
		Path:        "/api/metadata/platforms",
		Summary:     "Name IGDB platforms",
		Description: "Returns the names of IGDB platforms by id, such as those a platform is linked to " +
			"(see its igdb_platform_ids), which the library itself does not keep.",
		Tags: []string{"Metadata"},
		Errors: []int{http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusFailedDependency,
			http.StatusNotImplemented},
	}, func(ctx context.Context, input *listIGDBPlatformsInput) (*listIGDBPlatformsOutput, error) {
		if source == nil {
			return nil, errIGDBNotConfigured()
		}
		lookupCtx, cancel := context.WithTimeout(ctx, searchTimeout)
		defer cancel()
		platforms, err := source.Platforms(lookupCtx, input.IDs)
		if err != nil {
			slog.Warn("naming IGDB platforms failed", "error", err)
			return nil, errIGDBFailed()
		}

		out := &listIGDBPlatformsOutput{}
		out.Body.Platforms = make([]igdbPlatform, 0, len(platforms))
		for _, platform := range platforms {
			out.Body.Platforms = append(out.Body.Platforms,
				igdbPlatform{ID: platform.ID, Name: platform.Name, Abbreviation: platform.Abbreviation})
		}
		return out, nil
	})

	for _, page := range igdbPages {
		huma.Register(api, huma.Operation{
			OperationID: page.operationID,
			Method:      http.MethodGet,
			Path:        page.path,
			Summary:     "Open a " + page.noun + "'s page on IGDB",
			Description: page.description + " IGDB addresses its pages by name rather than by id, " +
				"so this is the way to reach one from an id alone.",
			Tags:          []string{"Metadata"},
			DefaultStatus: http.StatusFound,
			Errors: []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusFailedDependency,
				http.StatusNotImplemented},
		}, func(ctx context.Context, input *igdbPageInput) (*igdbPageOutput, error) {
			if source == nil {
				return nil, errIGDBNotConfigured()
			}
			lookupCtx, cancel := context.WithTimeout(ctx, searchTimeout)
			defer cancel()
			url, err := page.url(source, lookupCtx, input.ID)
			if errors.Is(err, igdb.ErrNotFound) {
				return nil, huma.Error404NotFound("IGDB has no " + page.noun + " with that id")
			}
			if err != nil {
				slog.Warn("looking an IGDB "+page.noun+" up failed", "id", input.ID, "error", err)
				return nil, errIGDBFailed()
			}
			return &igdbPageOutput{Status: http.StatusFound, Location: url}, nil
		})
	}
}

// errIGDBNotConfigured and errIGDBFailed are the two ways an operation that
// needs IGDB fails through no fault of the request.
func errIGDBNotConfigured() error {
	return errSourceNotConfigured("IGDB")
}

func errIGDBFailed() error {
	return errSourceFailed("IGDB")
}

// errSourceNotConfigured and errSourceFailed are the two ways an operation
// that needs an outside service fails through no fault of the request. See
// registerMetadata for why neither is a 502 or a 503.
func errSourceNotConfigured(name string) error {
	return huma.NewError(http.StatusNotImplemented, name+" is not configured on this deployment")
}

func errSourceFailed(name string) error {
	return huma.NewError(http.StatusFailedDependency, name+" could not be reached, or did not answer")
}

// companyMatcher pairs IGDB companies with the records of one library, read
// once per search rather than once per company.
type companyMatcher struct {
	candidates []namematch.Candidate
	names      map[uint64]string
	// links maps an IGDB company id onto the record it is linked to.
	links map[uint64]uint64
}

func newCompanyMatcher[T models.Developer | models.Publisher](ctx context.Context, db *gorm.DB, userID uint64) (*companyMatcher, error) {
	repo := repository.NewLookupRepository[T](db, userID)

	// The listing comes with each record's links, so the map of links is
	// built from it rather than read a second time.
	records, err := repo.List(ctx)
	if err != nil {
		return nil, err
	}

	matcher := &companyMatcher{
		candidates: make([]namematch.Candidate, 0, len(records)),
		names:      make(map[uint64]string, len(records)),
		links:      map[uint64]uint64{},
	}
	for _, record := range records {
		id, name, companies := lookupIdentity(record)
		matcher.candidates = append(matcher.candidates, namematch.Candidate{ID: id, Name: name})
		matcher.names[id] = name
		for _, company := range companies {
			matcher.links[company] = id
		}
	}
	return matcher, nil
}

// lookupIdentity reads the id, name and IGDB links of a developer or publisher.
func lookupIdentity[T models.Developer | models.Publisher](record T) (uint64, string, []uint64) {
	switch r := any(record).(type) {
	case models.Developer:
		return r.ID, r.Name, r.IGDBCompanyIDs
	case models.Publisher:
		return r.ID, r.Name, r.IGDBCompanyIDs
	default:
		// Unreachable: the constraint lists exactly those two.
		panic("not a developer or publisher")
	}
}

func (m *companyMatcher) matchAll(companies []igdb.Company) []companyMatch {
	out := make([]companyMatch, 0, len(companies))
	for _, company := range companies {
		out = append(out, companyMatch{IGDBCompanyID: company.ID, Name: company.Name, Match: m.match(company)})
	}
	return out
}

// match prefers a link, which is the user's own earlier choice, over any
// guess from the name.
func (m *companyMatcher) match(company igdb.Company) *matchTarget {
	if id, ok := m.links[company.ID]; ok {
		return &matchTarget{ID: id, Name: m.names[id], Reason: matchLinked}
	}
	if candidate, reason, ok := namematch.Best(company.Name, m.candidates); ok {
		return &matchTarget{ID: candidate.ID, Name: candidate.Name, Reason: matchReason(reason)}
	}
	return nil
}

// platformMatcher pairs IGDB platforms with the platforms of one library,
// read once per search.
type platformMatcher struct {
	candidates []namematch.Candidate
	names      map[uint64]string
	// links maps an IGDB platform id onto the platforms linked to it, the
	// one with the most games first.
	links map[uint64][]uint64
}

func newPlatformMatcher(ctx context.Context, db *gorm.DB, userID uint64) (*platformMatcher, error) {
	records, err := repository.NewLookupRepository[models.Platform](db, userID).List(ctx)
	if err != nil {
		return nil, err
	}
	// How many games each platform has, to choose among the platforms one
	// IGDB platform is linked to: the library's own habit is the best guess.
	games, err := repository.NewGameRepository(db, userID).CountByPlatform(ctx)
	if err != nil {
		return nil, err
	}

	matcher := &platformMatcher{
		candidates: make([]namematch.Candidate, 0, len(records)),
		names:      make(map[uint64]string, len(records)),
		links:      map[uint64][]uint64{},
	}
	// The listing is ordered by name, so a stable sort by games keeps ties
	// in alphabetical order.
	slices.SortStableFunc(records, func(a, b models.Platform) int { return cmp.Compare(games[b.ID], games[a.ID]) })
	for _, record := range records {
		matcher.candidates = append(matcher.candidates, namematch.Candidate{ID: record.ID, Name: record.Name})
		matcher.names[record.ID] = record.Name
		for _, platform := range record.IGDBPlatformIDs {
			matcher.links[platform] = append(matcher.links[platform], record.ID)
		}
	}
	return matcher, nil
}

func (m *platformMatcher) matchAll(platforms []igdb.Platform) []platformMatch {
	out := make([]platformMatch, 0, len(platforms))
	for _, platform := range platforms {
		out = append(out, platformMatch{
			IGDBPlatformID: platform.ID,
			Name:           platform.Name,
			Abbreviation:   platform.Abbreviation,
			Match:          m.match(platform),
		})
	}
	return out
}

// match prefers a link over any guess, and guesses from the abbreviation
// before the name: a library tends to call a platform what IGDB abbreviates
// it to ("PS5"), more than its full name. A shared prefix is not a guess
// worth making here, unlike for companies: "Xbox" is not "Xbox Series X",
// nor "Switch" the "Switch 2".
func (m *platformMatcher) match(platform igdb.Platform) *matchTarget {
	if linked := m.links[platform.ID]; len(linked) > 0 {
		return &matchTarget{ID: linked[0], Name: m.names[linked[0]], Reason: matchLinked}
	}
	for _, name := range []string{platform.Abbreviation, platform.Name} {
		if name == "" {
			continue
		}
		if candidate, reason, ok := namematch.Best(name, m.candidates); ok && reason != namematch.ReasonPrefix {
			return &matchTarget{ID: candidate.ID, Name: candidate.Name, Reason: matchReason(reason)}
		}
	}
	return nil
}
