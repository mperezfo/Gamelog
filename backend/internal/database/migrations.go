package database

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"

	"github.com/pressly/goose/v3"

	"github.com/mperezfo/gamelog/migrations"
)

// Migrate brings the schema up to the latest version.
//
// Migrations are the single source of truth for the schema: GORM's AutoMigrate
// is never used. Each migration runs exactly once, in order, tracked by goose
// in its own table.
func Migrate(ctx context.Context, db *sql.DB) error {
	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())

	if err := goose.SetDialect("mysql"); err != nil {
		return fmt.Errorf("setting goose dialect: %w", err)
	}

	before, err := goose.GetDBVersionContext(ctx, db)
	if err != nil {
		return fmt.Errorf("reading schema version: %w", err)
	}

	if err := goose.UpContext(ctx, db, "."); err != nil {
		return fmt.Errorf("applying migrations: %w", err)
	}

	after, err := goose.GetDBVersionContext(ctx, db)
	if err != nil {
		return fmt.Errorf("reading schema version: %w", err)
	}

	if before == after {
		slog.Info("schema already up to date", "version", after)
	} else {
		slog.Info("schema migrated", "from", before, "to", after)
	}
	return nil
}
