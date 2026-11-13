// Package testsupport spins up throwaway databases for tests.
//
// Tests must not depend on the development environment being up: each test
// binary starts its own MariaDB container, so `go test ./...` needs nothing but
// Docker.
package testsupport

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/mariadb"
	"gorm.io/gorm"

	"github.com/mperezfo/gamelog/internal/config"
	"github.com/mperezfo/gamelog/internal/database"
)

// mariadbImage matches the image used in compose.yaml, so tests exercise the
// same engine, defaults and collation as production.
const mariadbImage = "mariadb:11.4"

// The user the app connects as, and the password it shares with root, which
// creates and drops each test's database.
const (
	dbUser     = "gamelog"
	dbPassword = "gamelog"
)

// server is the MariaDB container a test binary shares: starting one takes
// several seconds, so it is started once, on the first test that needs it,
// and every test gets its own database inside it instead. Ryuk, the reaper
// testcontainers starts alongside it, removes it once the binary exits.
var server struct {
	once sync.Once
	host string
	port int
	root *sql.DB
	err  error
}

// databases numbers each test's database, so that no two share a name.
var databases atomic.Int64

func startServer() {
	ctx := context.Background()

	container, err := mariadb.Run(ctx, mariadbImage,
		mariadb.WithDatabase("gamelog"),
		mariadb.WithUsername(dbUser),
		mariadb.WithPassword(dbPassword),
		// Every test migrates a database of its own, and DDL is mostly
		// waiting on the disk: kept in memory, it does not have to.
		testcontainers.WithTmpfs(map[string]string{"/var/lib/mysql": "rw"}),
	)
	if err != nil {
		server.err = fmt.Errorf("starting the MariaDB container: %w", err)
		return
	}

	host, err := container.Host(ctx)
	if err != nil {
		server.err = fmt.Errorf("reading the container host: %w", err)
		return
	}
	port, err := container.MappedPort(ctx, "3306/tcp")
	if err != nil {
		server.err = fmt.Errorf("reading the mapped port: %w", err)
		return
	}

	root, err := sql.Open("mysql", fmt.Sprintf("root:%s@tcp(%s:%d)/", dbPassword, host, port.Num()))
	if err != nil {
		server.err = fmt.Errorf("connecting as root: %w", err)
		return
	}

	server.host, server.port, server.root = host, int(port.Num()), root
}

// NewDatabase creates an empty database, applies the migrations and returns a
// connection to it. The database is dropped when the test finishes.
//
// Integration tests are skipped under `go test -short`.
func NewDatabase(t *testing.T) *gorm.DB {
	t.Helper()

	if testing.Short() {
		t.Skip("skipping: needs Docker to start a MariaDB container")
	}

	server.once.Do(startServer)
	if server.err != nil {
		t.Fatal(server.err)
	}

	ctx := context.Background()

	name := fmt.Sprintf("test_%d", databases.Add(1))
	for _, stmt := range []string{
		"CREATE DATABASE " + name,
		fmt.Sprintf("GRANT ALL ON %s.* TO '%s'@'%%'", name, dbUser),
	} {
		if _, err := server.root.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("creating the test database: %v", err)
		}
	}
	t.Cleanup(func() {
		if _, err := server.root.ExecContext(ctx, "DROP DATABASE "+name); err != nil {
			t.Logf("dropping the test database: %v", err)
		}
	})

	cfg := config.Config{
		DBHost:     server.host,
		DBPort:     server.port,
		DBUser:     dbUser,
		DBPassword: dbPassword,
		DBName:     name,
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
