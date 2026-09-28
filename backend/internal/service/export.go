package service

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// Exporter reads one user's whole library into a Document.
type Exporter struct {
	db *gorm.DB
	// userID is the library being exported: the games and, since migration
	// 00013, the platforms, genres, developers and publishers too.
	userID uint64
}

// NewExporter builds the exporter for one user's library.
func NewExporter(db *gorm.DB, userID uint64) *Exporter {
	return &Exporter{db: db, userID: userID}
}

// Export reads every record of the library.
//
// Nothing is paged: the point of an export is to hand back the whole thing,
// and a personal game library is small enough that one pass over it costs less
// than the machinery for reading it in slices. Everything written is this
// exporter's user's own — nothing here can leak another account's records.
func (e *Exporter) Export(ctx context.Context) (*Document, error) {
	document := &Document{
		Version:    FormatVersion,
		ExportedAt: time.Now().UTC().Truncate(time.Second),
	}

	var err error
	if document.Platforms, err = exportLookups(ctx, e.db, e.userID, func(p models.Platform) LookupEntry {
		return LookupEntry{Name: p.Name, Icon: p.Icon, Color: p.Color}
	}); err != nil {
		return nil, err
	}
	if document.Genres, err = exportLookups(ctx, e.db, e.userID, func(g models.Genre) LookupEntry {
		return LookupEntry{Name: g.Name, Icon: g.Icon}
	}); err != nil {
		return nil, err
	}
	if document.Developers, err = exportLookups(ctx, e.db, e.userID, func(d models.Developer) LookupEntry {
		return LookupEntry{Name: d.Name, Icon: d.Icon}
	}); err != nil {
		return nil, err
	}
	if document.Publishers, err = exportLookups(ctx, e.db, e.userID, func(p models.Publisher) LookupEntry {
		return LookupEntry{Name: p.Name, Icon: p.Icon}
	}); err != nil {
		return nil, err
	}

	games, err := repository.NewGameRepository(e.db, e.userID).List(ctx, repository.GameFilter{})
	if err != nil {
		return nil, err
	}

	document.Games = make([]GameEntry, 0, len(games))
	for _, game := range games {
		document.Games = append(document.Games, exportGame(game))
	}

	return document, nil
}

// exportLookups reads one of the four simple entities the user owns, ordered
// by name.
func exportLookups[T repository.Lookup](ctx context.Context, db *gorm.DB, userID uint64, entry func(T) LookupEntry) ([]LookupEntry, error) {
	records, err := repository.NewLookupRepository[T](db, userID).List(ctx)
	if err != nil {
		return nil, err
	}

	entries := make([]LookupEntry, 0, len(records))
	for _, record := range records {
		entries = append(entries, entry(record))
	}
	return entries, nil
}

// exportGame writes one game, naming its relations instead of numbering them.
func exportGame(game models.Game) GameEntry {
	entry := GameEntry{
		Title:         game.Title,
		Status:        string(game.Status),
		Score:         game.Score,
		Tagline:       game.Tagline,
		Notes:         game.Notes,
		CoverImageURL: game.CoverImageURL,
		CoverFocalX:   game.CoverFocalX,
		CoverFocalY:   game.CoverFocalY,
		CoverZoom:     game.CoverZoom,
		ReleaseDate:   exportDate(game.ReleaseDate),
		LoggedDate:    exportDate(game.LoggedDate),
		Genres:        make([]string, 0, len(game.Genres)),
		Developers:    make([]string, 0, len(game.Developers)),
		Publishers:    make([]string, 0, len(game.Publishers)),
	}

	if game.Platform != nil {
		name := game.Platform.Name
		entry.Platform = &name
	}
	for _, genre := range game.Genres {
		entry.Genres = append(entry.Genres, genre.Name)
	}
	for _, developer := range game.Developers {
		entry.Developers = append(entry.Developers, developer.Name)
	}
	for _, publisher := range game.Publishers {
		entry.Publishers = append(entry.Publishers, publisher.Name)
	}

	return entry
}

// exportDate keeps only the calendar date, which is all the column holds.
func exportDate(value *time.Time) *Date {
	if value == nil {
		return nil
	}
	date := NewDate(*value)
	return &date
}
