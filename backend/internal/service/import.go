package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
)

// ImportMode decides what an import does with the library it finds.
type ImportMode string

const (
	// ImportModeMerge writes what the document carries over what is there and
	// leaves the rest alone. It is the mode that makes importing the same file
	// twice harmless.
	ImportModeMerge ImportMode = "merge"
	// ImportModeReplace empties the library before loading the document, so
	// that what comes out is exactly what went in. It is how a backup is
	// restored.
	ImportModeReplace ImportMode = "replace"
)

// Modes returns every accepted import mode, for validation and documentation.
func Modes() []ImportMode {
	return []ImportMode{ImportModeMerge, ImportModeReplace}
}

// ImportOptions are the choices the caller makes about one import.
type ImportOptions struct {
	// Mode defaults to ImportModeMerge.
	Mode ImportMode
	// DryRun runs the whole import and rolls it back, so that the report can
	// be read before anything is written.
	DryRun bool
}

// Counts is one number per section of the document.
type Counts struct {
	Platforms  int `json:"platforms"`
	Genres     int `json:"genres"`
	Developers int `json:"developers"`
	Publishers int `json:"publishers"`
	Games      int `json:"games"`
}

// Note is something the import had to decide on its own, tied to the entry
// that caused it. It is what makes a permissive import honest: everything it
// interpreted or left out is named here rather than silently applied.
type Note struct {
	Section string `json:"section" doc:"Section of the document the entry came from." example:"games"`
	Index   int    `json:"index" doc:"Position of the entry inside its section, counting from zero. -1 when the note is about the import as a whole." example:"3"`
	Entry   string `json:"entry" doc:"Name or title of the entry, when it has one." example:"Hollow Knight"`
	Message string `json:"message" doc:"What happened."`
}

// ImportReport is the answer to an import: what was written, and everything
// the importer had to interpret or leave out along the way.
type ImportReport struct {
	Mode   string `json:"mode" doc:"Mode the import ran in." example:"merge"`
	DryRun bool   `json:"dry_run" doc:"Whether the import was rolled back instead of committed."`

	Created Counts `json:"created" doc:"Records created."`
	Updated Counts `json:"updated" doc:"Records written over."`
	Deleted Counts `json:"deleted" doc:"Records removed before loading the document. Only the replace mode deletes anything, and only games: the platforms, genres, developers and publishers stay, at worst unused entries in a dropdown afterwards."`

	Skipped  []Note `json:"skipped" doc:"Entries that could not be imported. Everything else in the document still was."`
	Warnings []Note `json:"warnings" doc:"Entries that were imported after the importer had to interpret something."`
}

// noteLimit caps each list of notes, so that a bad file cannot answer with a
// line per row. What is left over is counted in a final note.
const noteLimit = 200

// errDryRun rolls the transaction back after a dry run. It never leaves
// Import.
var errDryRun = errors.New("dry run")

// Importer writes a document into one user's library.
type Importer struct {
	db *gorm.DB
	// userID is the library being written into: games land in it, and so do
	// the platforms, genres, developers and publishers a game names, created
	// in this same account as they come up.
	userID uint64
}

// NewImporter builds the importer for one user's library.
func NewImporter(db *gorm.DB, userID uint64) *Importer {
	return &Importer{db: db, userID: userID}
}

// Import writes the document and reports what it did.
//
// The whole import is one transaction: a document either lands completely or
// not at all, so a file that fails halfway cannot leave the library holding
// half of it. Entries the importer cannot make sense of are not failures —
// they are skipped and named in the report, which is what lets a file of a
// thousand games load despite three broken rows.
func (i *Importer) Import(ctx context.Context, document ImportDocument, options ImportOptions) (*ImportReport, error) {
	if options.Mode == "" {
		options.Mode = ImportModeMerge
	}

	report := &ImportReport{
		Mode:     string(options.Mode),
		DryRun:   options.DryRun,
		Skipped:  []Note{},
		Warnings: []Note{},
	}

	err := i.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := newImportRun(tx, i.userID, report).apply(ctx, document, options.Mode); err != nil {
			return err
		}
		if options.DryRun {
			return errDryRun
		}
		return nil
	})
	if err != nil && !errors.Is(err, errDryRun) {
		return nil, err
	}

	return report, nil
}

// importRun is one import in progress: the repositories bound to its
// transaction, and the report being filled in.
type importRun struct {
	games  *repository.GameRepository
	report *ImportReport

	platforms  lookupPort
	genres     lookupPort
	developers lookupPort
	publishers lookupPort

	// skipped and warned count every note, including the ones past noteLimit.
	skipped int
	warned  int
}

// newImportRun binds an import to a transaction and to one user's library.
func newImportRun(tx *gorm.DB, userID uint64, report *ImportReport) *importRun {
	return &importRun{
		games:  repository.NewGameRepository(tx, userID),
		report: report,

		// Only a platform has a colour (see models.Platform), so the other
		// three build functions take and ignore it: one generic importer for
		// all four is worth a parameter three of them do nothing with.
		platforms: newLookupImporter(tx, userID,
			func(id uint64, name string, icon, color *string) models.Platform {
				return models.Platform{ID: id, Name: name, Icon: icon, Color: color}
			},
			func(p *models.Platform) (uint64, *string, *string) { return p.ID, p.Icon, p.Color }),

		genres: newLookupImporter(tx, userID,
			func(id uint64, name string, icon, _ *string) models.Genre {
				return models.Genre{ID: id, Name: name, Icon: icon}
			},
			func(g *models.Genre) (uint64, *string, *string) { return g.ID, g.Icon, nil }),

		developers: newLookupImporter(tx, userID,
			func(id uint64, name string, icon, _ *string) models.Developer {
				return models.Developer{ID: id, Name: name, Icon: icon}
			},
			func(d *models.Developer) (uint64, *string, *string) { return d.ID, d.Icon, nil }),

		publishers: newLookupImporter(tx, userID,
			func(id uint64, name string, icon, _ *string) models.Publisher {
				return models.Publisher{ID: id, Name: name, Icon: icon}
			},
			func(p *models.Publisher) (uint64, *string, *string) { return p.ID, p.Icon, nil }),
	}
}

// section pairs one of the simple entities with its place in the document and
// in the report, so that the four of them are driven by the same code.
type section struct {
	name    string
	port    lookupPort
	entries []ImportLookup
	created *int
	updated *int
}

// sections lists the four simple entities in the order they have to be
// written: a game names them, so they exist before the games section runs.
func (r *importRun) sections(document ImportDocument) []section {
	return []section{
		{"platforms", r.platforms, document.Platforms, &r.report.Created.Platforms, &r.report.Updated.Platforms},
		{"genres", r.genres, document.Genres, &r.report.Created.Genres, &r.report.Updated.Genres},
		{"developers", r.developers, document.Developers, &r.report.Created.Developers, &r.report.Updated.Developers},
		{"publishers", r.publishers, document.Publishers, &r.report.Created.Publishers, &r.report.Updated.Publishers},
	}
}

// apply writes the whole document.
func (r *importRun) apply(ctx context.Context, document ImportDocument, mode ImportMode) error {
	sections := r.sections(document)

	if mode == ImportModeReplace {
		if err := r.wipe(ctx); err != nil {
			return err
		}
	}

	for _, section := range sections {
		if err := r.importLookups(ctx, section); err != nil {
			return err
		}
	}
	if err := r.importGames(ctx, document.Games); err != nil {
		return err
	}

	r.summarise()
	return nil
}

// wipe empties the caller's library. The join-table rows go with the games (ON
// DELETE CASCADE), so nothing is left pointing at a record that is gone.
//
// The platforms, genres, developers and publishers survive a replace on
// purpose, same as a merge: they are, at worst, unused entries in a dropdown
// afterwards, and deleting one is its own deliberate act.
func (r *importRun) wipe(ctx context.Context) error {
	deleted, err := r.games.DeleteAll(ctx)
	if err != nil {
		return err
	}
	r.report.Deleted.Games = int(deleted)
	return nil
}

// importLookups writes one section of simple entities.
func (r *importRun) importLookups(ctx context.Context, section section) error {
	for index, entry := range section.entries {
		name := ""
		if entry.Name != nil {
			name = strings.TrimSpace(*entry.Name)
		}
		if name == "" {
			r.skip(section.name, index, "", "an entry with no name cannot be imported")
			continue
		}

		created, err := section.port.apply(ctx, name, entry.Icon, entry.Color)
		if err != nil {
			return err
		}
		if created {
			*section.created++
		} else {
			*section.updated++
		}
	}
	return nil
}

// importGames writes the games section, creating along the way whatever
// platform, genre, developer or publisher a game names and the library does
// not have yet. That is what makes a document holding nothing but games a
// complete import.
func (r *importRun) importGames(ctx context.Context, entries []ImportGame) error {
	for index, entry := range entries {
		title := ""
		if entry.Title != nil {
			title = strings.TrimSpace(*entry.Title)
		}
		if title == "" {
			r.skip("games", index, "", "an entry with no title cannot be imported")
			continue
		}

		matches, err := r.games.FindByTitle(ctx, title)
		if err != nil {
			return err
		}
		if len(matches) > 1 {
			r.skip("games", index, title, fmt.Sprintf(
				"the library already holds %d games with this title, so there is no telling which one this entry means",
				len(matches)))
			continue
		}

		var current *models.Game
		if len(matches) == 1 {
			current = &matches[0]
		}

		game, relations, err := r.buildGame(ctx, index, title, entry, current)
		if err != nil {
			return err
		}

		if current == nil {
			if err := r.games.Create(ctx, game, relations); err != nil {
				return err
			}
			r.report.Created.Games++
			continue
		}

		if err := r.games.Update(ctx, game, relations); err != nil {
			return err
		}
		r.report.Updated.Games++
	}

	return nil
}

// buildGame turns one entry into the record to write.
//
// It starts from the game already in the library, when there is one, and
// overwrites only the fields the entry carries: an import of three columns
// updates three columns and leaves the rest of the game as it was.
func (r *importRun) buildGame(
	ctx context.Context,
	index int,
	title string,
	entry ImportGame,
	current *models.Game,
) (*models.Game, repository.GameRelations, error) {
	game := &models.Game{Title: title, Status: models.StatusPending}
	relations := repository.GameRelations{}

	if current != nil {
		game.ID = current.ID
		game.Status = current.Status
		game.Score = current.Score
		game.Tagline = current.Tagline
		game.Notes = current.Notes
		game.CoverImageURL = current.CoverImageURL
		game.CoverFocalX = current.CoverFocalX
		game.CoverFocalY = current.CoverFocalY
		game.CoverZoom = current.CoverZoom
		game.ReleaseDate = current.ReleaseDate
		game.LoggedDate = current.LoggedDate
		game.PlatformID = current.PlatformID
		relations = currentRelations(current)
	}

	if entry.Status != nil {
		raw := strings.TrimSpace(*entry.Status)
		status, known := parseStatus(raw)
		switch {
		case raw == "":
			// An empty status is not a status: the game keeps the one it has,
			// or is filed as pending when it is new.
		case known:
			game.Status = status
		default:
			r.warn("games", index, title, fmt.Sprintf(
				"%q is not a status this import knows, so the game was filed as %q instead", raw, game.Status))
		}
	}

	if entry.Score != nil {
		switch {
		case entry.Score.Blank:
			game.Score = nil
		case entry.Score.Value < 0 || entry.Score.Value > 10:
			r.warn("games", index, title, fmt.Sprintf(
				"a score has to be between 0 and 10, so %v was left out", entry.Score.Value))
		default:
			// Scores are stored with one decimal.
			score := math.Round(entry.Score.Value*10) / 10
			game.Score = &score
		}
	}

	game.Tagline = applyText(entry.Tagline, game.Tagline)
	game.Notes = applyText(entry.Notes, game.Notes)
	game.CoverImageURL = applyText(entry.CoverImageURL, game.CoverImageURL)

	game.CoverFocalX = r.applyUnitFraction(index, title, "cover_focal_x", entry.CoverFocalX, game.CoverFocalX)
	game.CoverFocalY = r.applyUnitFraction(index, title, "cover_focal_y", entry.CoverFocalY, game.CoverFocalY)
	if entry.CoverZoom != nil {
		switch {
		case entry.CoverZoom.Blank:
			game.CoverZoom = nil
		case entry.CoverZoom.Value < 1 || entry.CoverZoom.Value > 3:
			r.warn("games", index, title, fmt.Sprintf(
				"a cover zoom has to be between 1 and 3, so %v was left out", entry.CoverZoom.Value))
		default:
			zoom := entry.CoverZoom.Value
			game.CoverZoom = &zoom
		}
	}

	game.ReleaseDate = applyDate(entry.ReleaseDate, game.ReleaseDate)
	game.LoggedDate = applyDate(entry.LoggedDate, game.LoggedDate)

	if entry.Platform != nil {
		name := strings.TrimSpace(*entry.Platform)
		if name == "" {
			game.PlatformID = nil
		} else {
			id, err := r.resolve(ctx, r.platforms, name, &r.report.Created.Platforms)
			if err != nil {
				return nil, relations, err
			}
			game.PlatformID = &id
		}
	}

	for _, related := range []struct {
		names   Names
		port    lookupPort
		created *int
		into    *[]uint64
	}{
		{entry.Genres, r.genres, &r.report.Created.Genres, &relations.GenreIDs},
		{entry.Developers, r.developers, &r.report.Created.Developers, &relations.DeveloperIDs},
		{entry.Publishers, r.publishers, &r.report.Created.Publishers, &relations.PublisherIDs},
	} {
		// A relation the entry does not carry is left as it is; an empty one
		// clears it.
		if related.names == nil {
			continue
		}

		ids := make([]uint64, 0, len(related.names))
		for _, name := range related.names {
			id, err := r.resolve(ctx, related.port, name, related.created)
			if err != nil {
				return nil, relations, err
			}
			ids = append(ids, id)
		}
		*related.into = ids
	}

	return game, relations, nil
}

// applyUnitFraction reads one of the two cover focal point coordinates, which
// share the same 0 to 1 range and the same blank-clears, out-of-range-warns
// behaviour as a score.
func (r *importRun) applyUnitFraction(index int, title, field string, entry *Number, current *float64) *float64 {
	if entry == nil {
		return current
	}
	switch {
	case entry.Blank:
		return nil
	case entry.Value < 0 || entry.Value > 1:
		r.warn("games", index, title, fmt.Sprintf(
			"a %s has to be between 0 and 1, so %v was left out", field, entry.Value))
		return current
	default:
		value := entry.Value
		return &value
	}
}

// resolve turns the name of a related record into its id, counting it when it
// had to be created.
func (r *importRun) resolve(ctx context.Context, port lookupPort, name string, created *int) (uint64, error) {
	id, isNew, err := port.resolve(ctx, strings.TrimSpace(name))
	if err != nil {
		return 0, err
	}
	if isNew {
		*created++
	}
	return id, nil
}

// currentRelations reads back the relations a game already has, so that an
// entry which says nothing about them does not clear them.
func currentRelations(game *models.Game) repository.GameRelations {
	relations := repository.GameRelations{}

	for _, genre := range game.Genres {
		relations.GenreIDs = append(relations.GenreIDs, genre.ID)
	}
	for _, developer := range game.Developers {
		relations.DeveloperIDs = append(relations.DeveloperIDs, developer.ID)
	}
	for _, publisher := range game.Publishers {
		relations.PublisherIDs = append(relations.PublisherIDs, publisher.ID)
	}

	return relations
}

// applyText writes a text field: absent keeps what is stored, empty clears it.
func applyText(entry *string, current *string) *string {
	if entry == nil {
		return current
	}
	if text := strings.TrimSpace(*entry); text != "" {
		return &text
	}
	return nil
}

// applyDate writes a date field: absent keeps what is stored, empty clears it.
func applyDate(entry *Date, current *time.Time) *time.Time {
	if entry == nil {
		return current
	}
	if entry.Blank {
		return nil
	}
	value := entry.Time
	return &value
}

// skip records an entry that could not be imported.
func (r *importRun) skip(sectionName string, index int, entry, message string) {
	r.skipped++
	if len(r.report.Skipped) < noteLimit {
		r.report.Skipped = append(r.report.Skipped, Note{
			Section: sectionName, Index: index, Entry: entry, Message: message,
		})
	}
}

// warn records something the importer had to decide for an entry it did
// import.
func (r *importRun) warn(sectionName string, index int, entry, message string) {
	r.warned++
	if len(r.report.Warnings) < noteLimit {
		r.report.Warnings = append(r.report.Warnings, Note{
			Section: sectionName, Index: index, Entry: entry, Message: message,
		})
	}
}

// summarise closes off the lists of notes that had to be cut short.
func (r *importRun) summarise() {
	if left := r.skipped - len(r.report.Skipped); left > 0 {
		r.report.Skipped = append(r.report.Skipped, Note{
			Index:   -1,
			Message: fmt.Sprintf("%d more entries were skipped and are not listed here", left),
		})
	}
	if left := r.warned - len(r.report.Warnings); left > 0 {
		r.report.Warnings = append(r.report.Warnings, Note{
			Index:   -1,
			Message: fmt.Sprintf("%d more warnings are not listed here", left),
		})
	}
}

// lookupPort is one of the four simple entities as an import sees it: enough
// to write its own section and to turn the names a game uses into ids.
type lookupPort interface {
	// resolve returns the id of the record with that name, creating it when
	// the library does not have it yet.
	resolve(ctx context.Context, name string) (id uint64, created bool, err error)
	// apply writes one entry of the section of the document devoted to the
	// entity. color is only ever written for a platform.
	apply(ctx context.Context, name string, icon, color *string) (created bool, err error)
}

// lookupImporter implements lookupPort for one entity.
//
// build and inspect are the two things generics cannot do for a type
// parameter: set a field and read one. Everything else is shared.
type lookupImporter[T repository.Lookup] struct {
	repo    *repository.LookupRepository[T]
	build   func(id uint64, name string, icon, color *string) T
	inspect func(*T) (id uint64, icon, color *string)

	// cache remembers the names already looked up, so that a document naming
	// the same developer on forty games costs one query rather than forty.
	cache map[string]uint64
}

// newLookupImporter binds one entity to a transaction and to one user's
// library.
func newLookupImporter[T repository.Lookup](
	tx *gorm.DB,
	userID uint64,
	build func(id uint64, name string, icon, color *string) T,
	inspect func(*T) (uint64, *string, *string),
) *lookupImporter[T] {
	return &lookupImporter[T]{
		repo:    repository.NewLookupRepository[T](tx, userID),
		build:   build,
		inspect: inspect,
		cache:   map[string]uint64{},
	}
}

// resolve returns the id of the record with that name, creating it if needed.
func (l *lookupImporter[T]) resolve(ctx context.Context, name string) (uint64, bool, error) {
	if id, ok := l.cache[cacheKey(name)]; ok {
		return id, false, nil
	}

	record, err := l.repo.FindByName(ctx, name)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return 0, false, err
	}
	if err == nil {
		id, _, _ := l.inspect(record)
		l.cache[cacheKey(name)] = id
		return id, false, nil
	}

	created := l.build(0, name, nil, nil)
	if err := l.repo.Create(ctx, &created); err != nil {
		return 0, false, err
	}
	id, _, _ := l.inspect(&created)
	l.cache[cacheKey(name)] = id
	return id, true, nil
}

// apply writes one entry of the entity own section.
//
// The document wins over the library for what it carries: an entry renames a
// record whose stored spelling differs, and sets the icon and, for a
// platform, the colour it brings. Either one left out is kept, and an empty
// one is cleared.
func (l *lookupImporter[T]) apply(ctx context.Context, name string, icon, color *string) (bool, error) {
	record, err := l.repo.FindByName(ctx, name)
	if err != nil && !errors.Is(err, repository.ErrNotFound) {
		return false, err
	}

	if errors.Is(err, repository.ErrNotFound) {
		created := l.build(0, name, cleanOptional(icon), cleanOptional(color))
		if err := l.repo.Create(ctx, &created); err != nil {
			return false, err
		}
		id, _, _ := l.inspect(&created)
		l.cache[cacheKey(name)] = id
		return true, nil
	}

	id, storedIcon, storedColor := l.inspect(record)
	if icon == nil {
		icon = storedIcon
	}
	if color == nil {
		color = storedColor
	}

	updated := l.build(id, name, cleanOptional(icon), cleanOptional(color))
	if err := l.repo.Update(ctx, &updated); err != nil {
		return false, err
	}
	l.cache[cacheKey(name)] = id
	return false, nil
}

// cleanOptional turns an icon or a colour of nothing but spaces into none at
// all.
func cleanOptional(value *string) *string {
	if value == nil {
		return nil
	}
	if trimmed := strings.TrimSpace(*value); trimmed != "" {
		return &trimmed
	}
	return nil
}

// cacheKey is how a name is remembered within one import. The database has the
// last word on which names are the same record — its collation ignores case
// and accents — so this only has to be a key two spellings of the same typing
// agree on.
func cacheKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}
