package repository

import (
	"context"
	"time"

	"gorm.io/gorm"
)

// CountryGap is a developer or publisher of any account that has no country
// yet but is linked to IGDB companies, which may know it.
type CountryGap struct {
	// Table is the record's: developers or publishers.
	Table          string
	UserID         uint64
	ID             uint64
	IGDBCompanyIDs []uint64
}

// CountryGaps returns every developer and publisher, of every account, that
// has no country but is linked to an IGDB company, with its companies in
// ascending order.
//
// Across accounts, unlike everything else in this package: it serves a
// startup job that fills in what migration 00019 could not (see
// service.BackfillCompanyCountries), not a request of somebody's.
func CountryGaps(ctx context.Context, db *gorm.DB) ([]CountryGap, error) {
	var gaps []CountryGap
	for _, source := range []struct{ table, links, column string }{
		{"developers", "developer_igdb_companies", "developer_id"},
		{"publishers", "publisher_igdb_companies", "publisher_id"},
	} {
		var rows []struct {
			UserID        uint64 `gorm:"column:user_id"`
			ID            uint64 `gorm:"column:id"`
			IGDBCompanyID uint64 `gorm:"column:igdb_company_id"`
		}
		err := db.WithContext(ctx).
			Table(source.table + " AS r").
			Select("r.user_id, r.id, l.igdb_company_id").
			Joins("JOIN " + source.links + " AS l ON l." + source.column + " = r.id AND l.user_id = r.user_id").
			Where("r.country IS NULL").
			Order("r.id, l.igdb_company_id").
			Scan(&rows).Error
		if err != nil {
			return nil, translate(err)
		}

		for _, row := range rows {
			last := len(gaps) - 1
			if last >= 0 && gaps[last].Table == source.table && gaps[last].ID == row.ID {
				gaps[last].IGDBCompanyIDs = append(gaps[last].IGDBCompanyIDs, row.IGDBCompanyID)
				continue
			}
			gaps = append(gaps, CountryGap{
				Table:          source.table,
				UserID:         row.UserID,
				ID:             row.ID,
				IGDBCompanyIDs: []uint64{row.IGDBCompanyID},
			})
		}
	}
	return gaps, nil
}

// FillCountryGap gives the record of gap a country, unless it has gained one
// in the meantime.
func FillCountryGap(ctx context.Context, db *gorm.DB, gap CountryGap, code string) error {
	return fillCountry(ctx, db, gap.Table, gap.UserID, gap.ID, code)
}

// StartupJobDone reports whether the one-time startup job of that name has
// already run to the end. See migration 00019.
func StartupJobDone(ctx context.Context, db *gorm.DB, name string) (bool, error) {
	var count int64
	err := db.WithContext(ctx).Table("startup_jobs").Where("name = ?", name).Count(&count).Error
	return count > 0, translate(err)
}

// MarkStartupJobDone records that the startup job of that name has run to
// the end, so that it never runs again.
func MarkStartupJobDone(ctx context.Context, db *gorm.DB, name string, at time.Time) error {
	err := db.WithContext(ctx).Exec(
		"INSERT INTO startup_jobs (name, completed_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = name",
		name, at.UTC(),
	).Error
	return translate(err)
}
