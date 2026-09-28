package repository

import (
	"context"
	"fmt"
	"reflect"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/slug"
)

// Lookup constrains the four entities that share the same id/name/icon shape.
// They get one generic repository instead of four identical
// ones.
type Lookup interface {
	models.Genre | models.Developer | models.Publisher | models.Platform
}

// LookupRepository is the CRUD for a simple named entity, scoped to one
// owner exactly like GameRepository: the id is fixed at construction so no
// call site can forget the filter, and an id belonging to somebody else does
// not exist as far as this repository is concerned.
//
// Listing the games related to one of these is not here: it is a filter on
// GameRepository.List, which already has to support the same joins for the
// main table.
type LookupRepository[T Lookup] struct {
	db     *gorm.DB
	userID uint64
}

// NewLookupRepository builds a repository for one of the simple entities,
// scoped to one account's own records.
func NewLookupRepository[T Lookup](db *gorm.DB, userID uint64) *LookupRepository[T] {
	return &LookupRepository[T]{db: db, userID: userID}
}

// scoped starts a query restricted to this repository's owner.
func (r *LookupRepository[T]) scoped(ctx context.Context) *gorm.DB {
	return r.db.WithContext(ctx).Where("user_id = ?", r.userID)
}

// Create inserts entity, stamped with the repository's owner, and fills in
// its generated ID and slug.
func (r *LookupRepository[T]) Create(ctx context.Context, entity *T) error {
	setUserID(entity, r.userID)
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		assigned, err := r.assignSlug(ctx, tx, nameOf(entity), 0)
		if err != nil {
			return err
		}
		setSlug(entity, assigned)
		return tx.Create(entity).Error
	})
	return translate(err)
}

// Get returns the entity with the given ID, or ErrNotFound.
func (r *LookupRepository[T]) Get(ctx context.Context, id uint64) (*T, error) {
	var entity T
	if err := r.scoped(ctx).First(&entity, id).Error; err != nil {
		return nil, translate(err)
	}
	return &entity, nil
}

// List returns every entity the owner has, ordered by name.
func (r *LookupRepository[T]) List(ctx context.Context) ([]T, error) {
	var entities []T
	if err := r.scoped(ctx).Order("name").Find(&entities).Error; err != nil {
		return nil, translate(err)
	}
	return entities, nil
}

// Update overwrites the stored entity, stamped with the repository's owner so
// a request body cannot move a record to another account, and recomputes its
// slug from the new name the same way a game's is recomputed on a rename.
// Select("*") makes GORM write every column, including the zero values it
// would otherwise skip — so clearing an icon actually clears it.
func (r *LookupRepository[T]) Update(ctx context.Context, entity *T) error {
	setUserID(entity, r.userID)
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		assigned, err := r.assignSlug(ctx, tx, nameOf(entity), idOf(entity))
		if err != nil {
			return err
		}
		setSlug(entity, assigned)

		result := tx.Model(entity).Where("user_id = ?", r.userID).Select("*").Updates(entity)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	})
	return translate(err)
}

// assignSlug computes a unique slug for a name, scoped to this repository's
// owner — like a game's, since these four entities are now one account's own
// records rather than shared, two accounts are free to both have a genre
// that folds to the same slug. excludeID lets Update recompute an entity's
// own slug without colliding with the row it is already on.
func (r *LookupRepository[T]) assignSlug(ctx context.Context, tx *gorm.DB, name string, excludeID uint64) (string, error) {
	base := slug.Make(name)
	candidate := base

	for suffix := 2; ; suffix++ {
		var zero T
		query := tx.WithContext(ctx).Model(&zero).Where("user_id = ? AND slug = ?", r.userID, candidate)
		if excludeID != 0 {
			query = query.Where("id != ?", excludeID)
		}

		var count int64
		if err := query.Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s-%d", base, suffix)
	}
}

// BackfillSlugs assigns a slug to any of this owner's records that predate
// migration 00011. See GameRepository.BackfillSlugs for why this cannot be a
// plain SQL migration, and cmd/server/main.go for where it is called.
func (r *LookupRepository[T]) BackfillSlugs(ctx context.Context) (int, error) {
	var entities []T
	if err := r.scoped(ctx).Where("slug IS NULL OR slug = ?", "").Find(&entities).Error; err != nil {
		return 0, translate(err)
	}

	count := 0
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for i := range entities {
			entity := &entities[i]
			assigned, err := r.assignSlug(ctx, tx, nameOf(entity), idOf(entity))
			if err != nil {
				return err
			}
			if err := tx.Model(entity).Update("slug", assigned).Error; err != nil {
				return err
			}
			count++
		}
		return nil
	})
	return count, translate(err)
}

// nameOf, idOf, setSlug and setUserID reach into the few fields Create and
// Update need from a type they only know as a member of the Lookup type set,
// which — being a union of plain structs rather than a method interface —
// gives no other way to read or write a field generically. All four share
// every one of these field names, so this is safe.
func nameOf[T any](entity *T) string {
	return reflect.ValueOf(entity).Elem().FieldByName("Name").String()
}

func idOf[T any](entity *T) uint64 {
	return reflect.ValueOf(entity).Elem().FieldByName("ID").Uint()
}

func setSlug[T any](entity *T, value string) {
	reflect.ValueOf(entity).Elem().FieldByName("Slug").SetString(value)
}

func setUserID[T any](entity *T, userID uint64) {
	reflect.ValueOf(entity).Elem().FieldByName("UserID").SetUint(userID)
}

// lookupUsage names where a game points at one of the four simple entities:
// the join table for the N:M ones, the games table itself for a platform.
//
// It is a type switch rather than an argument to NewLookupRepository so that
// the call sites stay as short as they were.
func lookupUsage[T Lookup]() (table, column string) {
	var zero T
	switch any(zero).(type) {
	case models.Genre:
		return "game_genres", "genre_id"
	case models.Developer:
		return "game_developers", "developer_id"
	case models.Publisher:
		return "game_publishers", "publisher_id"
	case models.Platform:
		return "games", "platform_id"
	default:
		// Unreachable: the Lookup constraint lists exactly those four.
		panic("no usage mapping for this lookup type")
	}
}

// inUse reports whether any game still points at the record. The count is
// not scoped by owner: a game can only ever name a lookup row of its own
// account (see GameRepository's ownership validation), so an id already
// identifies at most one owner's usage.
func lookupInUse[T Lookup](db *gorm.DB, id uint64) (bool, error) {
	table, column := lookupUsage[T]()

	var count int64
	if err := db.Table(table).Where(column+" = ?", id).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// InUse reports whether any game still carries this record.
func (r *LookupRepository[T]) InUse(ctx context.Context, id uint64) (bool, error) {
	inUse, err := lookupInUse[T](r.db.WithContext(ctx), id)
	return inUse, translate(err)
}

// Delete removes the entity, unless a game still points at it, in which case
// it returns ErrInUse.
//
// The refusal is the point: the join tables cascade on delete and
// games.platform_id is set to NULL, so without it, deleting a genre would
// quietly strip it from every game that still carries it. Emptying a record
// of its last game first makes the deletion an explicit act rather than a
// side effect.
//
// The check and the delete share a transaction so that a game created in
// between cannot lose its genre to a delete that read a stale count.
func (r *LookupRepository[T]) Delete(ctx context.Context, id uint64) error {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		inUse, err := lookupInUse[T](tx, id)
		if err != nil {
			return err
		}
		if inUse {
			return ErrInUse
		}

		var entity T
		result := tx.Where("user_id = ?", r.userID).Delete(&entity, id)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return nil
	})
	return translate(err)
}

// FindByName returns the owner's entity with that name, or ErrNotFound.
//
// The comparison is the database's, not Go's: the name columns use a case-
// and accent-insensitive collation, so "pokemon" finds "Pokémon". That is what
// makes the JSON import idempotent — importing the same file twice does not
// end up with the same genre stored under two spellings.
func (r *LookupRepository[T]) FindByName(ctx context.Context, name string) (*T, error) {
	var entity T
	if err := r.scoped(ctx).Where("name = ?", name).First(&entity).Error; err != nil {
		return nil, translate(err)
	}
	return &entity, nil
}

// DeleteAll removes every record of the entity this repository's owner has.
func (r *LookupRepository[T]) DeleteAll(ctx context.Context) (int64, error) {
	var entity T
	result := r.scoped(ctx).Delete(&entity)
	return result.RowsAffected, translate(result.Error)
}
