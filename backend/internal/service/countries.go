package service

import (
	"context"
	"slices"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/repository"
)

// CompanyCountriesJob names the startup job that BackfillCompanyCountries
// runs, in the startup_jobs table.
const CompanyCountriesJob = "igdb-company-countries"

// companiesPerRequest is as many companies as IGDB is asked about at once,
// the most igdb.Client.Companies reads in one go.
const companiesPerRequest = 50

// CompanyLookup reads IGDB companies by id, as igdb.Client.Companies does.
type CompanyLookup func(ctx context.Context, ids []uint64) ([]igdb.Company, error)

// BackfillCompanyCountries gives a country to every developer and publisher,
// of every account, that was linked to IGDB before migration 00019 brought
// countries in, so that they do not each wait for a game of theirs to be
// identified again. Of several companies one record is linked to, the one
// with the lowest IGDB id that has a country wins.
//
// It runs once: after a run that gets to the end, startup_jobs says so and
// it does nothing ever again, so that a country cleared by hand since stays
// cleared. A run that fails part of the way (IGDB down, say) is not marked
// and starts over on the next startup, which only finds what is still
// missing. It returns how many records it filled in.
func BackfillCompanyCountries(ctx context.Context, db *gorm.DB, companies CompanyLookup, now time.Time) (int, error) {
	done, err := repository.StartupJobDone(ctx, db, CompanyCountriesJob)
	if err != nil || done {
		return 0, err
	}

	gaps, err := repository.CountryGaps(ctx, db)
	if err != nil {
		return 0, err
	}

	var ids []uint64
	for _, gap := range gaps {
		ids = append(ids, gap.IGDBCompanyIDs...)
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)

	countries := make(map[uint64]string, len(ids))
	for batch := range slices.Chunk(ids, companiesPerRequest) {
		found, err := companies(ctx, batch)
		if err != nil {
			return 0, err
		}
		for _, company := range found {
			if company.Country != "" {
				countries[company.ID] = company.Country
			}
		}
	}

	filled := 0
	for _, gap := range gaps {
		for _, id := range gap.IGDBCompanyIDs {
			code, ok := countries[id]
			if !ok {
				continue
			}
			if err := repository.FillCountryGap(ctx, db, gap, code); err != nil {
				return filled, err
			}
			filled++
			break
		}
	}

	return filled, repository.MarkStartupJobDone(ctx, db, CompanyCountriesJob, now)
}
