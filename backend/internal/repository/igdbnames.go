package repository

import (
	"context"
	"strings"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
)

// IGDBKind is a kind of IGDB record the library links to, as igdb_names
// tells them apart.
type IGDBKind string

const (
	IGDBCompany  IGDBKind = "company"
	IGDBPlatform IGDBKind = "platform"
)

// maxIGDBName is the longest name igdb_names holds, in characters. IGDB's
// names are far shorter; a longer one is cut rather than failing the save.
const maxIGDBName = 255

// SaveIGDBNames records the names IGDB gives records of one kind, replacing
// any it gave them before (see migration 00021).
//
// Across accounts, unlike everything else in this package: an IGDB record
// has the same name for every library. Only ever call it with what IGDB
// itself answered, never with a name a request carries.
func SaveIGDBNames(ctx context.Context, db *gorm.DB, kind IGDBKind, names []models.IGDBName) error {
	if len(names) == 0 {
		return nil
	}

	placeholders := make([]string, 0, len(names))
	values := make([]any, 0, len(names)*3)
	for _, named := range names {
		name := strings.TrimSpace(named.Name)
		if name == "" {
			continue
		}
		if runes := []rune(name); len(runes) > maxIGDBName {
			name = string(runes[:maxIGDBName])
		}
		placeholders = append(placeholders, "(?, ?, ?)")
		values = append(values, kind, named.ID, name)
	}
	if len(placeholders) == 0 {
		return nil
	}

	err := db.WithContext(ctx).Exec(
		"INSERT INTO igdb_names (kind, igdb_id, name) VALUES "+strings.Join(placeholders, ", ")+
			" ON DUPLICATE KEY UPDATE name = VALUES(name)",
		values...,
	).Error
	return translate(err)
}

// UnnamedIGDBLinks returns the IGDB records of one kind that any account
// links to and igdb_names has no name for, in ascending order.
//
// Across accounts, like SaveIGDBNames: it serves a startup pass (see
// service.FillIGDBNames), not a request of somebody's.
func UnnamedIGDBLinks(ctx context.Context, db *gorm.DB, kind IGDBKind) ([]uint64, error) {
	var sources []struct{ table, column string }
	switch kind {
	case IGDBCompany:
		sources = []struct{ table, column string }{
			{"developer_igdb_companies", "igdb_company_id"},
			{"publisher_igdb_companies", "igdb_company_id"},
		}
	case IGDBPlatform:
		sources = []struct{ table, column string }{{"platform_igdb_platforms", "igdb_platform_id"}}
	}

	selects := make([]string, 0, len(sources))
	for _, source := range sources {
		selects = append(selects, "SELECT "+source.column+" AS igdb_id FROM "+source.table)
	}

	var ids []uint64
	err := db.WithContext(ctx).Raw(
		"SELECT l.igdb_id FROM ("+strings.Join(selects, " UNION ")+") AS l"+
			" LEFT JOIN igdb_names AS n ON n.kind = ? AND n.igdb_id = l.igdb_id"+
			" WHERE n.igdb_id IS NULL ORDER BY l.igdb_id",
		kind,
	).Scan(&ids).Error
	return ids, translate(err)
}
