package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/service"
)

// maxBackupSize caps a backup upload before it is read into memory: a
// library's own covers add up, but nothing legitimate needs more than this.
const maxBackupSize = 128 << 20 // 128 MiB

// portabilityTag groups the two operations that move the whole library in and
// out of the application.
const portabilityTag = "Import and export"

// exportOutput carries the document plus the header that makes a browser save
// it as a file instead of painting it on screen. Fetching it from code is
// unaffected: the header only matters to a browser following a link.
type exportOutput struct {
	ContentDisposition string `header:"Content-Disposition"`
	Body               *service.Document
}

// importInput is the document plus the two decisions the caller makes about
// it.
//
// The mode values must stay in sync with service.Modes(), which a test in this
// package checks.
type importInput struct {
	Mode   string `query:"mode" enum:"merge,replace" default:"merge" doc:"How to treat the library that is already there. merge writes the document over it and leaves the rest alone; replace empties it first, which is how a backup is restored."`
	DryRun bool   `query:"dry_run" doc:"Run the import and roll it back, answering with the report it would have produced. The way to see what a file does before it does it."`

	Body service.ImportDocument
}

type importOutput struct {
	Body *service.ImportReport
}

// exportBackupOutput carries a whole backup .zip and the header that makes a
// browser save it as a file.
type exportBackupOutput struct {
	ContentType        string `header:"Content-Type"`
	ContentDisposition string `header:"Content-Disposition"`
	Body               []byte
}

// importBackupInput is a backup .zip, uploaded as a form file the same way a
// cover image is.
type importBackupInput struct {
	RawBody huma.MultipartFormFiles[struct {
		File huma.FormFile `form:"file" required:"true"`
	}]
}

// importBackupOutput carries the import report and the fresh session cookie:
// restoring a backup ends every session the account had, this browser's
// included, so a new one has to replace it for the request that asked to
// stay logged in.
type importBackupOutput struct {
	SetCookie http.Cookie `header:"Set-Cookie"`
	Body      *service.ImportReport
}

// registerPortability registers the JSON import and export, and the full
// account backup.
func registerPortability(api huma.API, db *gorm.DB, authentication *auth.Service, imagesDir string) {
	huma.Register(api, huma.Operation{
		OperationID: "export-library",
		Method:      http.MethodGet,
		Path:        "/api/export",
		Summary:     "Export the library",
		Description: "Returns your games, plus every genre, developer, publisher and platform of " +
			"yours, as a single JSON document.\n\n" +
			"Everything in it is yours alone; a name none of your games uses is still written, " +
			"costing nothing in a file whose point is to be importable elsewhere.\n\n" +
			"Relations are written by name rather than by id, so the file survives being " +
			"imported into another copy of Gamelog, edited by hand, or kept as a backup of a " +
			"database that no longer exists. It is the same shape POST /api/import reads.",
		Tags:   []string{portabilityTag},
		Errors: []int{http.StatusUnauthorized},
	}, func(ctx context.Context, _ *struct{}) (*exportOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		document, err := service.NewExporter(db, user.ID).Export(ctx)
		if err != nil {
			return nil, apiError(err, "nothing to export")
		}

		return &exportOutput{
			ContentDisposition: fmt.Sprintf("attachment; filename=%q", exportFilename(document.ExportedAt)),
			Body:               document,
		}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "import-library",
		Method:      http.MethodPost,
		Path:        "/api/import",
		Summary:     "Import a library",
		Description: "Loads a JSON document into your library.\n\n" +
			"The reader is deliberately forgiving, because the files worth importing come from " +
			"somewhere else. A document may carry every section or just one; the games section " +
			"alone is enough, since the platforms, genres, developers and publishers a game " +
			"names are created as they come up. The body may even be nothing but an array of " +
			"games.\n\n" +
			"Field names are matched ignoring case, spaces and punctuation, and common " +
			"alternatives are understood: `name` for `title`, `rating` for `score`, " +
			"`cover` or `image` for `cover_image_url`, `tags` for `genres`, and their Spanish " +
			"equivalents. Fields the format knows nothing about are ignored rather than " +
			"rejected. Statuses are read the same way: `backlog`, `in progress`, `finished` " +
			"and the like land on one of the four the application has.\n\n" +
			"Records are matched by name — by title, for a game — ignoring case and accents, so " +
			"importing the same file twice updates the same records instead of duplicating " +
			"them. Within a game, a field the document leaves out keeps the value the library " +
			"holds, while a field sent empty clears it.\n\n" +
			"Entries that cannot be imported do not fail the import: they are skipped and " +
			"listed in the report, together with everything the importer had to interpret. " +
			"Nothing is written unless the whole document is applied, and `dry_run=true` " +
			"answers with the report without writing at all.\n\n" +
			"`replace` empties your games and nobody else's. The platforms, genres, developers " +
			"and publishers survive it too: they are, at worst, unused entries in a dropdown " +
			"afterwards, and deleting one is its own deliberate act.",
		Tags:   []string{portabilityTag},
		Errors: []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *importInput) (*importOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		report, err := service.NewImporter(db, user.ID).Import(ctx, input.Body, service.ImportOptions{
			Mode:   service.ImportMode(input.Mode),
			DryRun: input.DryRun,
		})
		if err != nil {
			return nil, apiError(err, "nothing to import")
		}

		return &importOutput{Body: report}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "export-backup",
		Method:      http.MethodGet,
		Path:        "/api/backup",
		Summary:     "Export a full backup",
		Description: "Returns your whole account as a .zip: the same library GET /api/export " +
			"writes, plus your profile — name, picture and password — and every cover and " +
			"avatar image the library uses, so the file needs nothing else to be restored " +
			"elsewhere.\n\n" +
			"Restoring it (POST /api/backup) forces a password change before anything else " +
			"works, since the file carries your password hash and whoever holds it could " +
			"otherwise sign in as you until it is changed.",
		Tags:   []string{portabilityTag},
		Errors: []int{http.StatusUnauthorized},
	}, func(ctx context.Context, _ *struct{}) (*exportBackupOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		document, err := service.NewExporter(db, user.ID).Export(ctx)
		if err != nil {
			return nil, apiError(err, "nothing to export")
		}

		archive, err := buildBackupZip(document, service.AccountEntry{
			Name:         user.Name,
			AvatarURL:    user.AvatarURL,
			PasswordHash: user.PasswordHash,
			Theme:        user.Theme,
			DateFormat:   user.DateFormat,
			GamesView:    user.GamesView,
		}, imagesDir)
		if err != nil {
			return nil, fmt.Errorf("building the backup: %w", err)
		}

		return &exportBackupOutput{
			ContentType:        "application/zip",
			ContentDisposition: fmt.Sprintf("attachment; filename=%q", backupZipFilename(document.ExportedAt)),
			Body:               archive,
		}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "import-backup",
		Method:      http.MethodPost,
		Path:        "/api/backup",
		Summary:     "Restore a full backup",
		Description: "Loads a .zip produced by GET /api/backup: replaces your games the same " +
			"way POST /api/import does in replace mode (the platforms, genres, developers and " +
			"publishers survive), replaces your name, picture and password, and restores every " +
			"image the archive carries.\n\n" +
			"Because the file carries your password hash as it was at export time, restoring it " +
			"ends every session the account had, this browser's included — a fresh one opens in " +
			"its place — and nothing but changing your password works until you do.",
		Tags:   []string{portabilityTag},
		Errors: []int{http.StatusUnauthorized, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *importBackupInput) (*importBackupOutput, error) {
		user, err := currentUser(ctx)
		if err != nil {
			return nil, err
		}

		file := input.RawBody.Data().File
		if file.Size > maxBackupSize {
			return nil, huma.Error422UnprocessableEntity("backups are capped at 128 MiB")
		}

		data, err := io.ReadAll(io.LimitReader(file, maxBackupSize+1))
		if err != nil {
			return nil, fmt.Errorf("reading the uploaded backup: %w", err)
		}

		importDoc, account, images, err := readBackupZip(data)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}

		for name, content := range images {
			if err := restoreImage(imagesDir, name, content); err != nil {
				return nil, fmt.Errorf("restoring %s: %w", name, err)
			}
		}

		report, err := service.NewImporter(db, user.ID).Import(ctx, importDoc, service.ImportOptions{
			Mode: service.ImportModeReplace,
		})
		if err != nil {
			return nil, apiError(err, "nothing to import")
		}

		theme, dateFormat, gamesView := account.NormalisePreferences()
		if err := authentication.RestoreAccount(ctx, user.ID, account.Name, account.AvatarURL, account.PasswordHash, theme, dateFormat, gamesView); err != nil {
			return nil, apiError(err, "no such account")
		}

		session, err := authentication.Open(ctx, user.ID)
		if err != nil {
			return nil, fmt.Errorf("opening a fresh session: %w", err)
		}

		return &importBackupOutput{SetCookie: authentication.Cookie(session), Body: report}, nil
	})
}

// exportFilename is what a browser saves the export as.
func exportFilename(at time.Time) string {
	return "gamelog-" + at.Format(time.DateOnly) + ".json"
}

// backupZipFilename is what a browser saves a full backup as.
func backupZipFilename(at time.Time) string {
	return "gamelog-backup-" + at.Format(time.DateOnly) + ".zip"
}
