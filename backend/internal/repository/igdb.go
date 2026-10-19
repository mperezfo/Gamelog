package repository

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"strings"

	"github.com/mperezfo/gamelog/internal/models"
)

// CompanyLink ties a developer or publisher to the IGDB company it stands
// for. See migration 00016.
type CompanyLink struct {
	ID            uint64
	IGDBCompanyID uint64
}

// NewLookup is a developer or publisher that a game write names rather than
// numbers: found by its name when the library already has it, created
// otherwise, and linked to IGDBCompanyID when there is one.
type NewLookup struct {
	Name          string
	IGDBCompanyID *uint64
}

// errNotLinkable is returned when asking a genre or platform repository about
// IGDB companies. It is a programming error rather than something a request
// can cause, hence unexported.
var errNotLinkable = errors.New("only developers and publishers link to IGDB companies")

// igdbLinkTable names the table that links one entity to IGDB companies, and
// its column pointing back at the entity. Only developers and publishers have
// one.
func igdbLinkTable[T Lookup]() (table, column string, ok bool) {
	var zero T
	switch any(zero).(type) {
	case models.Developer:
		return "developer_igdb_companies", "developer_id", true
	case models.Publisher:
		return "publisher_igdb_companies", "publisher_id", true
	default:
		return "", "", false
	}
}

// igdbLinks returns which of the owner's records each linked IGDB company
// stands for, keyed by IGDB company id: all of them, or only the ones of
// record when it is not zero, read through the index on the record's column
// rather than the whole table.
func (r *LookupRepository[T]) igdbLinks(ctx context.Context, record uint64) (map[uint64]uint64, error) {
	table, column, ok := igdbLinkTable[T]()
	if !ok {
		return nil, errNotLinkable
	}

	var rows []struct {
		IGDBCompanyID uint64 `gorm:"column:igdb_company_id"`
		LookupID      uint64 `gorm:"column:lookup_id"`
	}
	query := r.db.WithContext(ctx).
		Table(table).
		Select("igdb_company_id, "+column+" AS lookup_id").
		Where("user_id = ?", r.userID)
	if record != 0 {
		query = query.Where(column+" = ?", record)
	}
	if err := query.Scan(&rows).Error; err != nil {
		return nil, translate(err)
	}

	links := make(map[uint64]uint64, len(rows))
	for _, row := range rows {
		links[row.IGDBCompanyID] = row.LookupID
	}
	return links, nil
}

// LinkIGDBCompanies ties each record to its IGDB company. An IGDB company
// already linked to another of the owner's records moves to the new one: it
// stands for one record at most, and the latest choice is the one to keep.
//
// Every record has to be the owner's, or nothing is written and
// ErrInvalidReference is returned, the same as for a game naming somebody
// else's genre.
func (r *LookupRepository[T]) LinkIGDBCompanies(ctx context.Context, links []CompanyLink) error {
	table, column, ok := igdbLinkTable[T]()
	if !ok {
		return errNotLinkable
	}
	if len(links) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(links))
	for _, link := range links {
		ids = append(ids, link.ID)
	}
	ids = dedupe(ids)

	var zero T
	var count int64
	if err := r.scoped(ctx).Model(&zero).Where("id IN ?", ids).Count(&count).Error; err != nil {
		return translate(err)
	}
	if int(count) != len(ids) {
		return ErrInvalidReference
	}

	placeholders := make([]string, 0, len(links))
	values := make([]any, 0, len(links)*3)
	for _, link := range links {
		placeholders = append(placeholders, "(?, ?, ?)")
		values = append(values, r.userID, link.IGDBCompanyID, link.ID)
	}

	err := r.db.WithContext(ctx).Exec(
		"INSERT INTO "+table+" (user_id, igdb_company_id, "+column+") VALUES "+
			strings.Join(placeholders, ", ")+
			" ON DUPLICATE KEY UPDATE "+column+" = VALUES("+column+")",
		values...,
	).Error
	return translate(err)
}

// attachIGDBCompanies fills in IGDBCompanyIDs on developers and publishers,
// sorted, so that a read hands back the links along with the records. It
// does nothing for genres and platforms, which have none.
func (r *LookupRepository[T]) attachIGDBCompanies(ctx context.Context, entities []T) error {
	if _, _, ok := igdbLinkTable[T](); !ok || len(entities) == 0 {
		return nil
	}

	// A single record (Get, Update) reads only its own links; a listing
	// reads them all in one go.
	var only uint64
	if len(entities) == 1 {
		only = idOf(&entities[0])
	}
	links, err := r.igdbLinks(ctx, only)
	if err != nil {
		return err
	}
	byRecord := make(map[uint64][]uint64)
	for company, record := range links {
		byRecord[record] = append(byRecord[record], company)
	}

	for i := range entities {
		companies := byRecord[idOf(&entities[i])]
		slices.Sort(companies)
		// The same reflection as nameOf and friends in lookup.go: only the
		// two types igdbLinkTable accepts have the field.
		reflect.ValueOf(&entities[i]).Elem().FieldByName("IGDBCompanyIDs").Set(reflect.ValueOf(companies))
	}
	return nil
}
