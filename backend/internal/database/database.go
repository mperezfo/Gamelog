// Package database owns the MariaDB connection and the schema migrations.
package database

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/mperezfo/gamelog/internal/config"
)

// Open connects to MariaDB and verifies the connection is usable.
//
// It never touches the schema: use Migrate for that.
func Open(ctx context.Context, cfg config.Config) (*gorm.DB, error) {
	db, err := gorm.Open(mysql.Open(cfg.DSN()), &gorm.Config{
		Logger: newSlogLogger(),
		// The schema is owned by the migrations, so GORM must not try to be
		// clever about naming or constraints on its own.
		DisableAutomaticPing:                     true,
		DisableForeignKeyConstraintWhenMigrating: true,
		NowFunc:                                  func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, fmt.Errorf("connecting to the database: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("obtaining the underlying connection pool: %w", err)
	}

	// Modest pool: this is a single-user, self-hosted application, and MariaDB
	// defaults to 151 max connections.
	sqlDB.SetMaxOpenConns(15)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)
	sqlDB.SetConnMaxIdleTime(10 * time.Minute)

	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("pinging the database: %w", err)
	}

	return db, nil
}

// Close releases the connection pool.
func Close(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}

// Ping reports whether the database is reachable. Used by the health endpoint.
func Ping(ctx context.Context, db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	return sqlDB.PingContext(ctx)
}

// slogWriter adapts GORM's logger to slog, so that every line the process
// emits has the same shape.
type slogWriter struct{}

func (slogWriter) Printf(format string, args ...any) {
	slog.Warn(fmt.Sprintf(format, args...), "source", "gorm")
}

func newSlogLogger() gormlogger.Interface {
	return gormlogger.New(slogWriter{}, gormlogger.Config{
		SlowThreshold: 200 * time.Millisecond,
		// Only warnings and errors: logging every statement would drown the
		// backend's own logs during development.
		LogLevel:                  gormlogger.Warn,
		IgnoreRecordNotFoundError: true,
		// Log statements with their placeholders rather than their values.
		// A rejected write is logged with the statement that caused it, and
		// that statement can be an INSERT into users carrying a password
		// hash: credential material has no business in a log an operator
		// reads, and the query alone is enough to understand the failure.
		ParameterizedQueries: true,
	})
}
