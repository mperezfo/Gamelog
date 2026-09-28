package repository

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/slug"
)

// GameRepository is the data access for one user's library.
type GameRepository struct {
	db *gorm.DB
	// userID is the owner every query is restricted to.
	userID uint64
}

// NewGameRepository builds the game repository for one user's library.
//
// The owner is fixed at construction rather than passed to each call on
// purpose: every query below is scoped to it, so no caller can reach another
// user's games by forgetting an argument. An id belonging to somebody else
// simply does not exist as far as this repository is concerned, which is what
// makes it a 404 rather than a 403.
func NewGameRepository(db *gorm.DB, userID uint64) *GameRepository {
	return &GameRepository{db: db, userID: userID}
}

// scoped starts a query restricted to this repository's user.
func (r *GameRepository) scoped(ctx context.Context) *gorm.DB {
	return r.db.WithContext(ctx).Where("games.user_id = ?", r.userID)
}

// GameRelations carries the ids of the N:M relations to attach to a game.
//
// Relations are passed as ids rather than as populated structs on purpose: it
// makes it impossible to accidentally create or rename a genre while saving a
// game, which is what GORM would do with a fully populated association.
type GameRelations struct {
	GenreIDs     []uint64
	DeveloperIDs []uint64
	PublisherIDs []uint64
}

// GameFilter narrows down a listing. A nil field means "no filter".
type GameFilter struct {
	Status      *models.Status
	PlatformID  *uint64
	GenreID     *uint64
	DeveloperID *uint64
	PublisherID *uint64

	// Sort is a key of sortColumns; empty means the default order.
	Sort string
	// Descending inverts the sort direction.
	Descending bool
}

// sortColumns is the allowlist of sortable fields. Sort keys arrive from query
// strings, so they are matched against this map and never interpolated into
// SQL.
var sortColumns = map[string]string{
	"title":        "games.title",
	"status":       "games.status",
	"score":        "games.score",
	"release_date": "games.release_date",
	"logged_date":  "games.logged_date",
	"created_at":   "games.created_at",
	"updated_at":   "games.updated_at",
}

// SortFields returns the accepted sort keys, for validation and documentation.
func SortFields() []string {
	fields := make([]string, 0, len(sortColumns))
	for field := range sortColumns {
		fields = append(fields, field)
	}
	return fields
}

// GameStats are the aggregates shown in the table footer.
type GameStats struct {
	Count           int64      `json:"count"`
	AverageScore    *float64   `json:"average_score"`
	FirstLoggedDate *time.Time `json:"first_logged_date"`
	LastLoggedDate  *time.Time `json:"last_logged_date"`
}

// relationNames maps each association to its join table and column, so the
// three N:M relations share one code path.
var relationNames = map[string]struct{ table, column string }{
	"Genres":     {"game_genres", "genre_id"},
	"Developers": {"game_developers", "developer_id"},
	"Publishers": {"game_publishers", "publisher_id"},
}

// Create inserts a game together with its relations, in a transaction.
func (r *GameRepository) Create(ctx context.Context, game *models.Game, rel GameRelations) error {
	// The owner is the repository's, never the caller's: a request body has no
	// say in which library a game lands in.
	owner := r.userID
	game.UserID = &owner

	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := r.checkOwnership(tx, game.PlatformID, rel); err != nil {
			return err
		}

		assigned, err := r.assignSlug(ctx, tx, game.Title, 0)
		if err != nil {
			return err
		}
		game.Slug = assigned

		// Omit the associations: they are written below, by id.
		if err := tx.Omit("Genres", "Developers", "Publishers", "Platform").Create(game).Error; err != nil {
			return err
		}
		return replaceRelations(tx, game.ID, rel)
	})
	return translate(err)
}

// checkOwnership makes sure every platform, genre, developer and publisher id
// a game names belongs to this repository's user, returning ErrInvalidReference
// otherwise. Since migration 00013 these four are one account's own records
// rather than shared, so a stray id from another account must be rejected the
// same way a nonexistent one already is — an id that exists but is not yours
// is, as far as your library is concerned, no id at all.
func (r *GameRepository) checkOwnership(tx *gorm.DB, platformID *uint64, rel GameRelations) error {
	if platformID != nil {
		var count int64
		if err := tx.Model(&models.Platform{}).
			Where("id = ? AND user_id = ?", *platformID, r.userID).
			Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return ErrInvalidReference
		}
	}

	checks := []struct {
		table string
		ids   []uint64
	}{
		{"genres", dedupe(rel.GenreIDs)},
		{"developers", dedupe(rel.DeveloperIDs)},
		{"publishers", dedupe(rel.PublisherIDs)},
	}
	for _, check := range checks {
		if len(check.ids) == 0 {
			continue
		}
		var count int64
		if err := tx.Table(check.table).
			Where("id IN ? AND user_id = ?", check.ids, r.userID).
			Count(&count).Error; err != nil {
			return err
		}
		if int(count) != len(check.ids) {
			return ErrInvalidReference
		}
	}
	return nil
}

// Get returns a game with its platform and its three relations loaded.
func (r *GameRepository) Get(ctx context.Context, id uint64) (*models.Game, error) {
	var game models.Game
	err := r.scoped(ctx).
		Preload("Platform").
		Preload("Genres", orderByName).
		Preload("Developers", orderByName).
		Preload("Publishers", orderByName).
		First(&game, id).Error
	if err != nil {
		return nil, translate(err)
	}
	return &game, nil
}

// GetBySlug returns a game by its slug, with the same preloads as Get.
func (r *GameRepository) GetBySlug(ctx context.Context, gameSlug string) (*models.Game, error) {
	var game models.Game
	err := r.scoped(ctx).
		Preload("Platform").
		Preload("Genres", orderByName).
		Preload("Developers", orderByName).
		Preload("Publishers", orderByName).
		Where("slug = ?", gameSlug).
		First(&game).Error
	if err != nil {
		return nil, translate(err)
	}
	return &game, nil
}

// Resolve turns a path segment that is either a numeric id or a slug into the
// game's id, so a handler can accept a URL shaped either way without caring
// which it got.
func (r *GameRepository) Resolve(ctx context.Context, ref string) (uint64, error) {
	if id, err := strconv.ParseUint(ref, 10, 64); err == nil {
		return id, nil
	}
	game, err := r.GetBySlug(ctx, ref)
	if err != nil {
		return 0, err
	}
	return game.ID, nil
}

// assignSlug computes a unique slug for a title, scoped to this repository's
// user — two accounts on the same deployment are free to both have a game
// that folds to the same slug. excludeID lets Update recompute a game's own
// slug without colliding with the row it is already on.
func (r *GameRepository) assignSlug(ctx context.Context, tx *gorm.DB, title string, excludeID uint64) (string, error) {
	base := slug.Make(title)
	candidate := base

	for suffix := 2; ; suffix++ {
		query := tx.WithContext(ctx).Model(&models.Game{}).Where("user_id = ? AND slug = ?", r.userID, candidate)
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

// BackfillSlugs assigns a slug to any of this user's games that do not have
// one yet. Migration 00005 adds the column but leaves existing rows NULL,
// since computing a unique value needs assignSlug's collision handling
// rather than anything a SQL migration can do on its own; see
// cmd/server/main.go, which calls this once per account at startup.
func (r *GameRepository) BackfillSlugs(ctx context.Context) (int, error) {
	var games []models.Game
	if err := r.scoped(ctx).Where("slug IS NULL OR slug = ?", "").Find(&games).Error; err != nil {
		return 0, translate(err)
	}

	count := 0
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, game := range games {
			assigned, err := r.assignSlug(ctx, tx, game.Title, game.ID)
			if err != nil {
				return err
			}
			if err := tx.Model(&models.Game{}).Where("id = ?", game.ID).Update("slug", assigned).Error; err != nil {
				return err
			}
			count++
		}
		return nil
	})
	return count, translate(err)
}

// Update overwrites a game and replaces its relations, in a transaction.
func (r *GameRepository) Update(ctx context.Context, game *models.Game, rel GameRelations) error {
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := r.checkOwnership(tx, game.PlatformID, rel); err != nil {
			return err
		}

		assigned, err := r.assignSlug(ctx, tx, game.Title, game.ID)
		if err != nil {
			return err
		}
		game.Slug = assigned

		// Select("*") writes every column, including zero values, so clearing
		// a score or a tagline actually clears it. created_at is excluded
		// because the caller does not own it.
		result := tx.Model(game).
			Where("games.user_id = ?", r.userID).
			Omit("Genres", "Developers", "Publishers", "Platform", "created_at", "user_id").
			Select("*").
			Updates(game)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrNotFound
		}
		return replaceRelations(tx, game.ID, rel)
	})
	return translate(err)
}

// Delete removes a game. Its rows in the join tables go with it (ON DELETE
// CASCADE).
func (r *GameRepository) Delete(ctx context.Context, id uint64) error {
	result := r.scoped(ctx).Delete(&models.Game{}, id)
	if result.Error != nil {
		return translate(result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// List returns the games matching filter, with their relations loaded.
func (r *GameRepository) List(ctx context.Context, filter GameFilter) ([]models.Game, error) {
	query, err := r.filtered(ctx, filter)
	if err != nil {
		return nil, err
	}

	order := "games.title"
	if filter.Sort != "" {
		column, ok := sortColumns[filter.Sort]
		if !ok {
			return nil, fmt.Errorf("%w: %q", ErrInvalidSort, filter.Sort)
		}
		order = column
	}
	if filter.Descending {
		order += " DESC"
	}
	// Tie-break on id so paging and repeated reads are stable.
	order += ", games.id"

	var games []models.Game
	err = query.
		Preload("Platform").
		Preload("Genres", orderByName).
		Preload("Developers", orderByName).
		Preload("Publishers", orderByName).
		Order(order).
		Find(&games).Error
	if err != nil {
		return nil, translate(err)
	}
	return games, nil
}

// Stats returns the footer aggregates for the same filter as List.
func (r *GameRepository) Stats(ctx context.Context, filter GameFilter) (GameStats, error) {
	query, err := r.filtered(ctx, filter)
	if err != nil {
		return GameStats{}, err
	}

	var stats GameStats
	err = query.Select(
		"COUNT(*) AS count",
		"AVG(games.score) AS average_score",
		"MIN(games.logged_date) AS first_logged_date",
		"MAX(games.logged_date) AS last_logged_date",
	).Scan(&stats).Error
	if err != nil {
		return GameStats{}, translate(err)
	}
	return stats, nil
}

// filtered builds the shared WHERE/JOIN clauses used by List and Stats.
func (r *GameRepository) filtered(ctx context.Context, filter GameFilter) (*gorm.DB, error) {
	// The owner is the one filter that is never optional.
	query := r.scoped(ctx).Model(&models.Game{})

	if filter.Status != nil {
		if !filter.Status.Valid() {
			return nil, fmt.Errorf("unknown status %q", *filter.Status)
		}
		query = query.Where("games.status = ?", *filter.Status)
	}
	if filter.PlatformID != nil {
		query = query.Where("games.platform_id = ?", *filter.PlatformID)
	}

	// One join per active relation filter. Each join table has (game_id, x_id)
	// as its primary key, so a game can match at most one row and no DISTINCT
	// is needed.
	for name, id := range map[string]*uint64{
		"Genres":     filter.GenreID,
		"Developers": filter.DeveloperID,
		"Publishers": filter.PublisherID,
	} {
		if id == nil {
			continue
		}
		rel := relationNames[name]
		query = query.Joins(
			fmt.Sprintf("JOIN %s ON %s.game_id = games.id AND %s.%s = ?", rel.table, rel.table, rel.table, rel.column),
			*id,
		)
	}

	return query, nil
}

// replaceRelations rewrites the join-table rows for one game.
//
// The join tables are written directly instead of through GORM associations:
// it is a delete plus one batch insert, and it cannot touch the genre,
// developer or publisher rows themselves.
func replaceRelations(tx *gorm.DB, gameID uint64, rel GameRelations) error {
	for name, ids := range map[string][]uint64{
		"Genres":     rel.GenreIDs,
		"Developers": rel.DeveloperIDs,
		"Publishers": rel.PublisherIDs,
	} {
		meta := relationNames[name]

		if err := tx.Exec(
			fmt.Sprintf("DELETE FROM %s WHERE game_id = ?", meta.table), gameID,
		).Error; err != nil {
			return err
		}

		unique := dedupe(ids)
		if len(unique) == 0 {
			continue
		}

		values := make([]any, 0, len(unique)*2)
		placeholders := ""
		for i, id := range unique {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += "(?, ?)"
			values = append(values, gameID, id)
		}

		if err := tx.Exec(
			fmt.Sprintf("INSERT INTO %s (game_id, %s) VALUES %s", meta.table, meta.column, placeholders),
			values...,
		).Error; err != nil {
			return err
		}
	}
	return nil
}

// dedupe removes repeated ids while preserving order, so a caller sending the
// same genre twice does not trip the join table's primary key.
func dedupe(ids []uint64) []uint64 {
	seen := make(map[uint64]struct{}, len(ids))
	out := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// orderByName keeps preloaded relations in a stable, readable order.
func orderByName(db *gorm.DB) *gorm.DB { return db.Order("name") }

// FindByTitle returns the games whose title matches, with their platform and
// their relations loaded. The comparison is the column's collation, so it
// ignores case and accents.
//
// It returns every match rather than the first one because games have no
// unique title: the import needs to know when a title is ambiguous instead of
// silently overwriting one of two records that share it.
func (r *GameRepository) FindByTitle(ctx context.Context, title string) ([]models.Game, error) {
	var games []models.Game
	err := r.scoped(ctx).
		Preload("Platform").
		Preload("Genres", orderByName).
		Preload("Developers", orderByName).
		Preload("Publishers", orderByName).
		Where("title = ?", title).
		Order("games.id").
		Find(&games).Error
	if err != nil {
		return nil, translate(err)
	}
	return games, nil
}

// DeleteAll removes every game of this repository's user, and with it every
// row of the join tables (ON DELETE CASCADE). Other libraries are untouched.
//
// The genres, developers, publishers and platforms stay: they are, at worst,
// unreferenced entries in this same account's dropdowns afterwards, and
// deleting one is its own deliberate act through its own repository.
func (r *GameRepository) DeleteAll(ctx context.Context) (int64, error) {
	result := r.scoped(ctx).Delete(&models.Game{})
	return result.RowsAffected, translate(result.Error)
}
