package repository

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"strings"

	"github.com/mperezfo/gamelog/internal/models"
)

// IGDBLink ties a developer, publisher or platform to the IGDB record (a
// company, or a platform) it stands for. See migrations 00016 and 00018.
type IGDBLink struct {
	ID     uint64
	IGDBID uint64
}

// NewLookup is a developer, publisher or platform that a game write names
// rather than numbers: found by its name when the library already has it,
// created otherwise, and linked to IGDBID when there is one.
type NewLookup struct {
	Name   string
	IGDBID *uint64
}

// errNotLinkable is returned when asking a genre repository about IGDB. It
// is a programming error rather than something a request can cause, hence
// unexported.
var errNotLinkable = errors.New("only developers, publishers and platforms link to IGDB")

// igdbLinkSpec describes the table that links one entity to IGDB.
type igdbLinkSpec struct {
	table string
	// igdbColumn holds the IGDB id, and recordColumn the entity's.
	igdbColumn   string
	recordColumn string
	// field is the entity's field the links are read into.
	field string
	// exclusive is whether an IGDB record stands for one record at most, so
	// that linking it again moves it: true for companies, false for
	// platforms (see migration 00018).
	exclusive bool
}

// igdbLinkTable describes the link table of T. Genres have none.
func igdbLinkTable[T Lookup]() (igdbLinkSpec, bool) {
	var zero T
	switch any(zero).(type) {
	case models.Developer:
		return igdbLinkSpec{"developer_igdb_companies", "igdb_company_id", "developer_id", "IGDBCompanyIDs", true}, true
	case models.Publisher:
		return igdbLinkSpec{"publisher_igdb_companies", "igdb_company_id", "publisher_id", "IGDBCompanyIDs", true}, true
	case models.Platform:
		return igdbLinkSpec{"platform_igdb_platforms", "igdb_platform_id", "platform_id", "IGDBPlatformIDs", false}, true
	default:
		return igdbLinkSpec{}, false
	}
}

// igdbLinks returns the IGDB ids each of the owner's records is linked to,
// keyed by record: all of them, or only the ones of record when it is not
// zero, read through the index on the record's column rather than the whole
// table.
func (r *LookupRepository[T]) igdbLinks(ctx context.Context, record uint64) (map[uint64][]uint64, error) {
	spec, ok := igdbLinkTable[T]()
	if !ok {
		return nil, errNotLinkable
	}

	var rows []struct {
		IGDBID   uint64 `gorm:"column:igdb_id"`
		LookupID uint64 `gorm:"column:lookup_id"`
	}
	query := r.db.WithContext(ctx).
		Table(spec.table).
		Select(spec.igdbColumn+" AS igdb_id, "+spec.recordColumn+" AS lookup_id").
		Where("user_id = ?", r.userID)
	if record != 0 {
		query = query.Where(spec.recordColumn+" = ?", record)
	}
	if err := query.Scan(&rows).Error; err != nil {
		return nil, translate(err)
	}

	links := make(map[uint64][]uint64)
	for _, row := range rows {
		links[row.LookupID] = append(links[row.LookupID], row.IGDBID)
	}
	return links, nil
}

// LinkIGDB ties each record to its IGDB record. An IGDB company already
// linked to another of the owner's developers (or publishers) moves to the
// new one: it stands for one record at most, and the latest choice is the
// one to keep. An IGDB platform keeps the platforms it was linked to, and
// gains the new one.
//
// Every record has to be the owner's, or nothing is written and
// ErrInvalidReference is returned, the same as for a game naming somebody
// else's genre.
func (r *LookupRepository[T]) LinkIGDB(ctx context.Context, links []IGDBLink) error {
	spec, ok := igdbLinkTable[T]()
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
		values = append(values, r.userID, link.IGDBID, link.ID)
	}

	// The same statement either way: an exclusive link moves to the new
	// record, while for any other a pair already there is simply left as
	// it is, rather than ignored along with every other error as INSERT
	// IGNORE would.
	onDuplicate := spec.recordColumn + " = " + spec.recordColumn
	if spec.exclusive {
		onDuplicate = spec.recordColumn + " = VALUES(" + spec.recordColumn + ")"
	}
	err := r.db.WithContext(ctx).Exec(
		"INSERT INTO "+spec.table+" (user_id, "+spec.igdbColumn+", "+spec.recordColumn+") VALUES "+
			strings.Join(placeholders, ", ")+
			" ON DUPLICATE KEY UPDATE "+onDuplicate,
		values...,
	).Error
	return translate(err)
}

// UnlinkIGDB unties one of the owner's records from one IGDB record. It
// returns ErrNotFound when the record is not the owner's, or not linked to
// that IGDB record.
func (r *LookupRepository[T]) UnlinkIGDB(ctx context.Context, id, igdbID uint64) error {
	spec, ok := igdbLinkTable[T]()
	if !ok {
		return errNotLinkable
	}

	// The owner is part of the key, so another account's record, or a
	// link of someone else's, simply matches nothing.
	result := r.db.WithContext(ctx).Exec(
		"DELETE FROM "+spec.table+" WHERE user_id = ? AND "+spec.recordColumn+" = ? AND "+spec.igdbColumn+" = ?",
		r.userID, id, igdbID,
	)
	if result.Error != nil {
		return translate(result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// attachIGDBLinks fills in the IGDB ids of developers, publishers and
// platforms, sorted, so that a read hands back the links along with the
// records. It does nothing for genres, which have none.
func (r *LookupRepository[T]) attachIGDBLinks(ctx context.Context, entities []T) error {
	spec, ok := igdbLinkTable[T]()
	if !ok || len(entities) == 0 {
		return nil
	}

	// A single record (Get, Update) reads only its own links; a listing
	// reads them all in one go.
	var only uint64
	if len(entities) == 1 {
		only = idOf(&entities[0])
	}
	byRecord, err := r.igdbLinks(ctx, only)
	if err != nil {
		return err
	}

	for i := range entities {
		linked := byRecord[idOf(&entities[i])]
		slices.Sort(linked)
		// The same reflection as nameOf and friends in lookup.go: only the
		// types igdbLinkTable accepts have the field.
		reflect.ValueOf(&entities[i]).Elem().FieldByName(spec.field).Set(reflect.ValueOf(linked))
	}
	return nil
}
