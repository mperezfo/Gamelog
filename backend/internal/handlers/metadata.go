package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
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
	Companies(ctx context.Context, ids []uint64) ([]igdb.Company, error)
}

type metadataCapabilitiesOutput struct {
	Body struct {
		Identify bool `json:"identify" doc:"Whether games can be looked up on IGDB, which needs the deployment to be configured with IGDB credentials."`
	}
}

type searchGameMetadataInput struct {
	Title string `query:"title" required:"true" minLength:"1" maxLength:"255" doc:"Title to look up." example:"Resident Evil 4"`
}

// matchReason documents how a company was matched to a record of the library.
type matchReason string

const (
	// matchLinked is a record already linked to the IGDB company: no guess.
	matchLinked matchReason = "linked"
)

// companyMatchTarget is the record of the library a company is likely to be.
type companyMatchTarget struct {
	ID     uint64      `json:"id" doc:"Id of the developer or publisher." example:"3"`
	Name   string      `json:"name" doc:"Its name." example:"Sony"`
	Reason matchReason `json:"reason" enum:"linked,name,normalized,prefix" doc:"How it was found: linked to this IGDB company already, the same name ignoring case and accents, the same name without company suffixes and generic words, or one name starting with the other. Only linked is certain; the rest are suggestions."`
}

// companyMatch is a developer or publisher of a candidate, with the record of
// the library it most likely is.
type companyMatch struct {
	IGDBCompanyID uint64              `json:"igdb_company_id" doc:"IGDB's id for the company." example:"10100"`
	Name          string              `json:"name" doc:"The company's name on IGDB." example:"Sony Interactive Entertainment"`
	Match         *companyMatchTarget `json:"match" doc:"The developer or publisher of the library this company most likely is. Null when none is close enough to suggest."`
}

// gameCandidate is one IGDB game a title may refer to.
type gameCandidate struct {
	IGDBID uint64 `json:"igdb_id" doc:"IGDB's id for the game." example:"26192"`
	Name   string `json:"name" doc:"Title on IGDB." example:"Resident Evil 4"`
	// RFC 3339 at midnight UTC, the same shape as a game's release_date, so
	// that it can be written back as it is.
	ReleaseDate *time.Time     `json:"release_date" doc:"First release date across every platform, RFC 3339. Null when IGDB does not know it." example:"2023-03-24T00:00:00Z"`
	Platforms   []string       `json:"platforms" doc:"Platforms it was released on, as IGDB names them." example:"[\"PlayStation 5\"]"`
	CoverURL    *string        `json:"cover_url" doc:"Small cover hosted by IGDB, to tell candidates apart. Not meant to be stored: see the Images tag." example:"https://images.igdb.com/igdb/image/upload/t_cover_small/co6bo0.jpg"`
	Developers  []companyMatch `json:"developers" doc:"Developers, each with the developer of the library it most likely is."`
	Publishers  []companyMatch `json:"publishers" doc:"Publishers, each with the publisher of the library it most likely is."`
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

type companyPageInput struct {
	ID uint64 `path:"id" doc:"IGDB's id for the company." example:"37"`
}

type companyPageOutput struct {
	Status   int
	Location string `header:"Location" doc:"The company's page on igdb.com."`
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
// game form's Identify button. source is nil when the deployment has no IGDB
// credentials, in which case the capabilities say so and the rest answer 501.
//
// Neither failure answers 502 or 503, the statuses a gateway would use: the
// frontend reads those, from any endpoint, as the server being unreachable
// and switches to its offline mode, when only IGDB is.
func registerMetadata(api huma.API, db *gorm.DB, source IGDB) {
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
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "search-game-metadata",
		Method:      http.MethodGet,
		Path:        "/api/metadata/games",
		Summary:     "Look a game up on IGDB",
		Description: "Searches IGDB for the games a title may refer to, with their release date, " +
			"developers and publishers. Each developer and publisher comes with the record of the " +
			"caller's library it most likely is, to write back with a game's developer_ids, " +
			"new_developers and developer_links (and their publisher equivalents).",
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

		out := &searchGameMetadataOutput{}
		out.Body.Candidates = make([]gameCandidate, 0, len(results))
		for _, result := range results {
			out.Body.Candidates = append(out.Body.Candidates, gameCandidate{
				IGDBID:      result.ID,
				Name:        result.Name,
				ReleaseDate: result.ReleaseDate,
				Platforms:   result.Platforms,
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
		OperationID: "open-igdb-company",
		Method:      http.MethodGet,
		Path:        "/api/metadata/companies/{id}/page",
		Summary:     "Open a company's page on IGDB",
		Description: "Redirects to the page of an IGDB company, such as the one a developer or publisher " +
			"is linked to (see its igdb_company_ids). IGDB addresses its pages by name rather than " +
			"by id, so this is the way to reach one from an id alone.",
		Tags:          []string{"Metadata"},
		DefaultStatus: http.StatusFound,
		Errors: []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusFailedDependency,
			http.StatusNotImplemented},
	}, func(ctx context.Context, input *companyPageInput) (*companyPageOutput, error) {
		if source == nil {
			return nil, errIGDBNotConfigured()
		}
		lookupCtx, cancel := context.WithTimeout(ctx, searchTimeout)
		defer cancel()
		url, err := source.CompanyURL(lookupCtx, input.ID)
		if errors.Is(err, igdb.ErrNotFound) {
			return nil, huma.Error404NotFound("IGDB has no company with that id")
		}
		if err != nil {
			slog.Warn("looking an IGDB company up failed", "id", input.ID, "error", err)
			return nil, errIGDBFailed()
		}
		return &companyPageOutput{Status: http.StatusFound, Location: url}, nil
	})
}

// errIGDBNotConfigured and errIGDBFailed are the two ways an operation that
// needs IGDB fails through no fault of the request. See registerMetadata for
// why neither is a 502 or a 503.
func errIGDBNotConfigured() error {
	return huma.NewError(http.StatusNotImplemented, "IGDB is not configured on this deployment")
}

func errIGDBFailed() error {
	return huma.NewError(http.StatusFailedDependency, "IGDB could not be reached, or did not answer")
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
func (m *companyMatcher) match(company igdb.Company) *companyMatchTarget {
	if id, ok := m.links[company.ID]; ok {
		return &companyMatchTarget{ID: id, Name: m.names[id], Reason: matchLinked}
	}
	if candidate, reason, ok := namematch.Best(company.Name, m.candidates); ok {
		return &companyMatchTarget{ID: candidate.ID, Name: candidate.Name, Reason: matchReason(reason)}
	}
	return nil
}
