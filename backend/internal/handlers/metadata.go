package handlers

import (
	"context"
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

// GameSearcher looks games up by title on IGDB. *igdb.Client is the one in
// use; tests pass a fake rather than a whole IGDB.
type GameSearcher interface {
	Search(ctx context.Context, title string) ([]igdb.Game, error)
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

type searchGameMetadataOutput struct {
	Body struct {
		Candidates []gameCandidate `json:"candidates" doc:"Games the title may refer to, most relevant first."`
	}
}

// registerMetadata registers the lookups of game metadata on IGDB, behind the
// game form's Identify button. games is nil when the deployment has no IGDB
// credentials, in which case the capabilities say so and a search answers 503.
func registerMetadata(api huma.API, db *gorm.DB, games GameSearcher) {
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
		out.Body.Identify = games != nil
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
		Errors: []int{http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusBadGateway, http.StatusServiceUnavailable},
	}, func(ctx context.Context, input *searchGameMetadataInput) (*searchGameMetadataOutput, error) {
		if games == nil {
			return nil, huma.Error503ServiceUnavailable("IGDB is not configured on this deployment")
		}
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		results, err := games.Search(ctx, strings.TrimSpace(input.Title))
		if err != nil {
			slog.Warn("searching IGDB failed", "error", err)
			return nil, huma.Error502BadGateway("IGDB could not be reached, or did not answer")
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

	records, err := repo.List(ctx)
	if err != nil {
		return nil, err
	}
	links, err := repo.IGDBCompanies(ctx)
	if err != nil {
		return nil, err
	}

	matcher := &companyMatcher{
		candidates: make([]namematch.Candidate, 0, len(records)),
		names:      make(map[uint64]string, len(records)),
		links:      links,
	}
	for _, record := range records {
		id, name := lookupIdentity(record)
		matcher.candidates = append(matcher.candidates, namematch.Candidate{ID: id, Name: name})
		matcher.names[id] = name
	}
	return matcher, nil
}

// lookupIdentity reads the id and name of a developer or publisher.
func lookupIdentity[T models.Developer | models.Publisher](record T) (uint64, string) {
	switch r := any(record).(type) {
	case models.Developer:
		return r.ID, r.Name
	case models.Publisher:
		return r.ID, r.Name
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
