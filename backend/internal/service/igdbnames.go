package service

import (
	"context"
	"slices"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// PlatformLookup reads IGDB platforms by id, as igdb.Client.Platforms does.
type PlatformLookup func(ctx context.Context, ids []uint64) ([]igdb.Platform, error)

// FillIGDBNames names every IGDB company and platform that some account
// links to and igdb_names has no name for yet (see migration 00021): the
// links made before the table existed, and those a backup brought in since.
//
// Unlike BackfillCompanyCountries it runs on every startup, since a restore
// can bring new links in at any time, and it has nothing to undo by hand:
// with every link named it only reads the database. A record IGDB does not
// know stays unnamed, and is asked about again on the next startup. It
// returns how many records it named.
func FillIGDBNames(ctx context.Context, db *gorm.DB, companies CompanyLookup, platforms PlatformLookup) (int, error) {
	named := 0

	ids, err := repository.UnnamedIGDBLinks(ctx, db, repository.IGDBCompany)
	if err != nil {
		return named, err
	}
	for batch := range slices.Chunk(ids, companiesPerRequest) {
		found, err := companies(ctx, batch)
		if err != nil {
			return named, err
		}
		names := make([]models.IGDBName, 0, len(found))
		for _, company := range found {
			names = append(names, models.IGDBName{ID: company.ID, Name: company.Name})
		}
		if err := repository.SaveIGDBNames(ctx, db, repository.IGDBCompany, names); err != nil {
			return named, err
		}
		named += len(names)
	}

	ids, err = repository.UnnamedIGDBLinks(ctx, db, repository.IGDBPlatform)
	if err != nil {
		return named, err
	}
	// igdb.Client.Platforms reads as many at once as Companies does.
	for batch := range slices.Chunk(ids, companiesPerRequest) {
		found, err := platforms(ctx, batch)
		if err != nil {
			return named, err
		}
		names := make([]models.IGDBName, 0, len(found))
		for _, platform := range found {
			names = append(names, models.IGDBName{ID: platform.ID, Name: platform.Name})
		}
		if err := repository.SaveIGDBNames(ctx, db, repository.IGDBPlatform, names); err != nil {
			return named, err
		}
		named += len(names)
	}

	return named, nil
}
