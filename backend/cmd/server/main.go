// Command server starts the Gamelog HTTP API.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/auth"
	"github.com/mperezfo/gamelog/internal/config"
	"github.com/mperezfo/gamelog/internal/database"
	"github.com/mperezfo/gamelog/internal/igdb"
	"github.com/mperezfo/gamelog/internal/imagefile"
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/router"
	"github.com/mperezfo/gamelog/internal/service"
)

// version identifies the running build: a git tag, or a short commit hash
// when the build has none. Set at build time with
// -ldflags "-X main.version=...", which is what the Dockerfile does; left at
// its default for `go run` and `air`, so a local dev server reports "dev"
// rather than pretending to be a real release.
var version = "dev"

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	var tasks maintenance
	flag.BoolVar(&tasks.resetAdmin, "reset-admin-password", false,
		"Read a new password for the admin account from stdin, set it, and exit. "+
			"The way back into a deployment whose admin password was lost.")
	flag.BoolVar(&tasks.normalizeImages, "normalize-images", false,
		"Convert every stored image the backend cannot read (AVIF, typically) to JPEG or PNG, "+
			"move the games and accounts that use it to the new file, and exit.")
	flag.BoolVar(&tasks.pruneImages, "prune-images", false,
		"Delete every stored image no game cover or account picture uses, with its thumbnails, "+
			"and exit. Images from the last hour are kept, as they may be about to be used.")
	flag.BoolVar(&tasks.dryRun, "dry-run", false,
		"With -normalize-images or -prune-images: list what would change, and change nothing.")
	flag.Parse()

	if err := run(tasks); err != nil {
		slog.Error("server exited with an error", "error", err)
		os.Exit(1)
	}
}

// maintenance is the one-off tasks the flags ask for instead of serving.
type maintenance struct {
	resetAdmin      bool
	normalizeImages bool
	pruneImages     bool
	dryRun          bool
}

func run(tasks maintenance) error {
	picked := 0
	for _, task := range []bool{tasks.resetAdmin, tasks.normalizeImages, tasks.pruneImages} {
		if task {
			picked++
		}
	}
	if picked > 1 {
		return errors.New("-reset-admin-password, -normalize-images and -prune-images are separate runs: pick one")
	}
	if tasks.dryRun && !tasks.normalizeImages && !tasks.pruneImages {
		return errors.New("-dry-run only applies to -normalize-images and -prune-images")
	}

	cfg, err := config.Load(config.DotEnvFile)
	if err != nil {
		return fmt.Errorf("loading configuration: %w", err)
	}

	if err := os.MkdirAll(cfg.ImagesDir, 0o755); err != nil {
		return fmt.Errorf("creating the images directory %q: %w", cfg.ImagesDir, err)
	}

	// Stop signal: Ctrl-C locally, SIGTERM when Docker stops the container.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := database.Open(ctx, cfg)
	if err != nil {
		return err
	}
	defer func() {
		if err := database.Close(db); err != nil {
			slog.Error("closing the database", "error", err)
		}
	}()
	slog.Info("database connected", "host", cfg.DBHost, "port", cfg.DBPort, "name", cfg.DBName)

	if cfg.RunMigrations {
		sqlDB, err := db.DB()
		if err != nil {
			return fmt.Errorf("obtaining the underlying connection pool: %w", err)
		}
		if err := database.Migrate(ctx, sqlDB); err != nil {
			return err
		}
	} else {
		slog.Warn("migrations skipped", "reason", "GAMELOG_MIGRATE=false")
	}

	authentication := auth.NewService(db, auth.Options{
		Lifetime:     cfg.SessionLifetime,
		SecureCookie: cfg.SecureCookie,
	})

	// A maintenance run: do the task and leave without listening.
	if tasks.resetAdmin {
		return resetAdminPassword(ctx, authentication)
	}
	if tasks.normalizeImages {
		return normalizeImages(ctx, db, cfg.ImagesDir, tasks.dryRun)
	}
	if tasks.pruneImages {
		return pruneImages(ctx, db, cfg.ImagesDir, tasks.dryRun)
	}

	if err := bootstrapAdmin(ctx, authentication, cfg.AdminPassword); err != nil {
		return err
	}
	announceSetup(ctx, authentication)
	sweepSessions(ctx, authentication)
	if err := backfillSlugs(ctx, authentication, db); err != nil {
		return err
	}
	if cfg.IGDBEnabled() {
		go backfillCompanyCountries(ctx, db, igdb.New(cfg.IGDBClientID, cfg.IGDBClientSecret, cfg.IGDBSearchLimit))
	}

	srv := &http.Server{
		Addr:              net.JoinHostPort("", strconv.Itoa(cfg.Port)),
		Handler:           router.New(cfg, db, authentication, version),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("server listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("listening on %s: %w", srv.Addr, err)
	case <-ctx.Done():
		slog.Info("shutdown requested, closing connections")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutting down the server: %w", err)
	}

	slog.Info("server stopped cleanly")
	return nil
}

// bootstrapAdmin creates the admin account from GAMELOG_ADMIN_PASSWORD, for a
// deployment that is installed without anybody watching.
//
// It only ever fires on a deployment with no accounts at all, so leaving the
// variable set does not reset anything on the next restart.
func bootstrapAdmin(ctx context.Context, authentication *auth.Service, password string) error {
	if password == "" {
		return nil
	}

	pending, err := authentication.Pending(ctx)
	if err != nil {
		return fmt.Errorf("checking whether the deployment has accounts: %w", err)
	}
	if !pending {
		slog.Info("GAMELOG_ADMIN_PASSWORD ignored", "reason", "this deployment already has accounts")
		return nil
	}

	if _, err := authentication.Bootstrap(ctx, password); err != nil {
		return fmt.Errorf("creating the admin account from GAMELOG_ADMIN_PASSWORD: %w", err)
	}
	return nil
}

// announceSetup says so when the deployment is still waiting for its first
// run, which is otherwise only visible by opening the application.
func announceSetup(ctx context.Context, authentication *auth.Service) {
	pending, err := authentication.Pending(ctx)
	if err != nil {
		slog.Warn("could not tell whether the deployment has accounts", "error", err)
		return
	}
	if pending {
		slog.Info("no accounts yet: open the application to choose the admin password")
	}
}

// sweepSessions deletes the sessions that have already expired.
//
// Only at startup: nothing depends on those rows being gone, since resolving a
// session ignores expired ones, so a periodic job would be more machinery than
// the problem is worth.
func sweepSessions(ctx context.Context, authentication *auth.Service) {
	swept, err := authentication.Sessions().DeleteExpired(ctx, time.Now().UTC())
	if err != nil {
		slog.Warn("could not sweep expired sessions", "error", err)
		return
	}
	if swept > 0 {
		slog.Info("swept expired sessions", "sessions", swept)
	}
}

// backfillCompanyCountries gives the developers and publishers linked to
// IGDB before countries existed the country IGDB has for them, once (see
// service.BackfillCompanyCountries). In the background, since it waits on
// IGDB, and nothing depends on it: a failure only means trying again on the
// next start.
func backfillCompanyCountries(ctx context.Context, db *gorm.DB, client *igdb.Client) {
	filled, err := service.BackfillCompanyCountries(ctx, db, client.Companies, time.Now())
	if err != nil {
		slog.Warn("could not fill in the countries of developers and publishers from IGDB", "error", err)
		return
	}
	if filled > 0 {
		slog.Info("filled in countries of developers and publishers from IGDB", "records", filled)
	}
}

// backfillSlugs assigns a slug to any game that predates migration 00005,
// and to any genre, developer, publisher or platform that predates migration
// 00011, one account at a time: every one of these five repositories is now
// scoped to a single library (see migration 00013), and there is no
// cross-account query worth adding just for a startup pass that only ever
// has anything to do once.
func backfillSlugs(ctx context.Context, authentication *auth.Service, db *gorm.DB) error {
	users, err := authentication.Users().List(ctx)
	if err != nil {
		return fmt.Errorf("listing accounts to backfill slugs: %w", err)
	}

	var games, genres, developers, publishers, platforms int
	for _, user := range users {
		filled, err := repository.NewGameRepository(db, user.ID).BackfillSlugs(ctx)
		if err != nil {
			return fmt.Errorf("backfilling game slugs for %q: %w", user.Username, err)
		}
		games += filled

		g, err := repository.NewLookupRepository[models.Genre](db, user.ID).BackfillSlugs(ctx)
		if err != nil {
			return fmt.Errorf("backfilling genre slugs for %q: %w", user.Username, err)
		}
		genres += g

		d, err := repository.NewLookupRepository[models.Developer](db, user.ID).BackfillSlugs(ctx)
		if err != nil {
			return fmt.Errorf("backfilling developer slugs for %q: %w", user.Username, err)
		}
		developers += d

		p, err := repository.NewLookupRepository[models.Publisher](db, user.ID).BackfillSlugs(ctx)
		if err != nil {
			return fmt.Errorf("backfilling publisher slugs for %q: %w", user.Username, err)
		}
		publishers += p

		pl, err := repository.NewLookupRepository[models.Platform](db, user.ID).BackfillSlugs(ctx)
		if err != nil {
			return fmt.Errorf("backfilling platform slugs for %q: %w", user.Username, err)
		}
		platforms += pl
	}

	if games > 0 {
		slog.Info("backfilled game slugs", "games", games)
	}
	if total := genres + developers + publishers + platforms; total > 0 {
		slog.Info("backfilled lookup slugs",
			"genres", genres, "developers", developers, "publishers", publishers, "platforms", platforms)
	}
	return nil
}

// resetAdminPassword is the way back into a deployment whose admin password
// was lost. It needs shell access to the deployment, which is exactly the
// authorisation that ought to be required to take one over.
//
// The password is read from stdin rather than taken as an argument, so that it
// does not end up in the shell history or in the process list. It is echoed
// while being typed: hiding it would mean pulling in a terminal library for a
// command that is run about once.
func resetAdminPassword(ctx context.Context, authentication *auth.Service) error {
	fmt.Fprintf(os.Stderr, "New password for %q (it will be visible as you type): ", auth.AdminUsername)

	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("reading the new password: %w", err)
	}
	password := strings.TrimRight(line, "\r\n")

	user, err := authentication.Users().FindByUsername(ctx, auth.AdminUsername)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			return fmt.Errorf(
				"there is no %q account yet: start the server and choose the admin password in the application",
				auth.AdminUsername)
		}
		return fmt.Errorf("looking up the admin account: %w", err)
	}

	if err := authentication.SetPassword(ctx, user.ID, password); err != nil {
		return fmt.Errorf("setting the admin password: %w", err)
	}

	slog.Info("admin password reset", "sessions", "every session the account had has ended")
	return nil
}

// normalizeImages converts every stored image the backend cannot read, the
// way uploads have been converted on the way in since: images stored before
// that (or restored from a backup made before it) can be AVIF files under a
// .png name, which get no thumbnails and are slow to show.
func normalizeImages(ctx context.Context, db *gorm.DB, dir string, dryRun bool) error {
	names, err := imagefile.StoredNames(dir)
	if err != nil {
		return err
	}

	report, err := imagefile.NormalizeStored(ctx, db, dir, names, dryRun)
	if err != nil {
		return err
	}

	verb := "converted"
	if dryRun {
		verb = "would convert"
	}
	for _, conversion := range report.Converted {
		found := string(conversion.Found)
		if found == "" {
			found = "unknown"
		}
		slog.Info(verb, "from", conversion.From, "to", conversion.To, "found", found,
			"games", conversion.Games, "accounts", conversion.Users)
	}
	for _, failure := range report.Failed {
		slog.Warn("could not read", "image", failure.Name, "error", failure.Err)
	}
	slog.Info("images checked", "checked", report.Checked, "converted", len(report.Converted),
		"unreadable", len(report.Failed), "dry_run", dryRun)
	return nil
}

// pruneImages deletes the stored images nothing uses (see
// imagefile.PruneStored), or with dryRun lists them, and logs what it did.
func pruneImages(ctx context.Context, db *gorm.DB, dir string, dryRun bool) error {
	report, err := imagefile.PruneStored(ctx, db, dir, time.Now(), dryRun)
	if err != nil {
		return err
	}

	verb := "deleted"
	if dryRun {
		verb = "would delete"
	}
	for _, image := range report.Pruned {
		slog.Info(verb, "image", image.Name, "thumbnails", image.Thumbnails, "bytes", image.Size)
	}
	if report.StrayThumbnails > 0 {
		slog.Info(verb+" thumbnails of images already gone", "thumbnails", report.StrayThumbnails,
			"bytes", report.StraySize)
	}
	slog.Info("images checked", "checked", report.Checked, "unused", len(report.Pruned),
		"kept_recent", report.Recent, "freed_mib", fmt.Sprintf("%.1f", float64(report.Freed())/(1<<20)),
		"dry_run", dryRun)
	return nil
}
