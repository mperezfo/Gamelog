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
	"github.com/mperezfo/gamelog/internal/models"
	"github.com/mperezfo/gamelog/internal/notify"
	"github.com/mperezfo/gamelog/internal/repository"
	"github.com/mperezfo/gamelog/internal/router"
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

	resetAdmin := flag.Bool("reset-admin-password", false,
		"Read a new password for the admin account from stdin, set it, and exit. "+
			"The way back into a deployment whose admin password was lost.")
	flag.Parse()

	if err := run(*resetAdmin); err != nil {
		slog.Error("server exited with an error", "error", err)
		os.Exit(1)
	}
}

func run(resetAdmin bool) error {
	cfg, err := config.Load()
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

	// A maintenance run: set the password and leave without listening.
	if resetAdmin {
		return resetAdminPassword(ctx, authentication)
	}

	if err := bootstrapAdmin(ctx, authentication, cfg.AdminPassword); err != nil {
		return err
	}
	announceSetup(ctx, authentication)
	sweepSessions(ctx, authentication)
	if err := backfillSlugs(ctx, authentication, db); err != nil {
		return err
	}

	// Release reminders go out from this process, for as long as it runs.
	go notify.NewScheduler(db, router.NotificationChannels(cfg), cfg.NotifyHour).Run(ctx)

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
