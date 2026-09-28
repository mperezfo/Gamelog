// Package testsupport spins up throwaway databases for tests.
//
// Tests must not depend on the development environment being up: each run
// starts its own MariaDB container and migrates it, so `go test ./...` needs
// nothing but Docker.
package testsupport

import (
	"context"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/mariadb"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/config"
	"github.com/mperezfo/gamelog/internal/database"
)

// mariadbImage matches the image used in compose.yaml, so tests exercise the
// same engine, defaults and collation as production.
const mariadbImage = "mariadb:11.4"

// NewDatabase starts a MariaDB container, applies the migrations and returns a
// connection to it. The container is terminated when the test finishes.
//
// Integration tests are skipped under `go test -short`.
func NewDatabase(t *testing.T) *gorm.DB {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping: needs Docker to start a MariaDB container")
	}

	ctx := context.Background()

	container, err := mariadb.Run(ctx, mariadbImage,
		mariadb.WithDatabase("gamelog"),
		mariadb.WithUsername("gamelog"),
		mariadb.WithPassword("gamelog"),
	)
	if err != nil {
		t.Fatalf("starting the MariaDB container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Logf("terminating the MariaDB container: %v", err)
		}
	})

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("reading the container host: %v", err)
	}
	port, err := container.MappedPort(ctx, "3306/tcp")
	if err != nil {
		t.Fatalf("reading the mapped port: %v", err)
	}

	cfg := config.Config{
		DBHost:     host,
		DBPort:     int(port.Num()),
		DBUser:     "gamelog",
		DBPassword: "gamelog",
		DBName:     "gamelog",
	}

	openCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	db, err := database.Open(openCtx, cfg)
	if err != nil {
		t.Fatalf("connecting to the test database: %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(db); err != nil {
			t.Logf("closing the test database: %v", err)
		}
	})

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("obtaining the connection pool: %v", err)
	}
	if err := database.Migrate(ctx, sqlDB); err != nil {
		t.Fatalf("migrating the test database: %v", err)
	}

	return db
}
