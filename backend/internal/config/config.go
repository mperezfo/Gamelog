// Package config loads the server configuration from environment variables.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all process configuration. It is loaded once at startup and
// passed explicitly to whoever needs it, with no global state.
type Config struct {
	// HTTP port the API listens on.
	Port int

	// MariaDB connection details.
	DBHost     string
	DBPort     int
	DBUser     string
	DBPassword string
	DBName     string

	// DocsEnabled serves the interactive API documentation under /api/docs.
	// On by default: the browsable, request-issuing console is the point of
	// documenting the API in the first place, and the requests it issues need
	// a session like any other. Set GAMELOG_DOCS=false to take the page away
	// anyway. The OpenAPI document itself is always served: it describes the
	// API, it does not grant access to it.
	DocsEnabled bool

	// SessionLifetime is how long a logged-in browser stays logged in without
	// being used. It is a year by default, and a session in regular use
	// renews itself, so in practice nobody is ever signed out. This is a
	// private game library: being asked to log in again every fortnight would
	// cost more than it buys.
	SessionLifetime time.Duration

	// SecureCookie marks the session cookie Secure, which stops a browser
	// from ever sending it over plain HTTP.
	//
	// It is off by default, and that default is deliberate rather than lazy:
	// the intended deployment is a private network or a Tailscale address
	// reached over http://, where a Secure cookie is never sent back and
	// nobody can log in at all. Turn it on (GAMELOG_SECURE_COOKIE=true) for
	// any deployment served over HTTPS.
	SecureCookie bool

	// AdminPassword creates the admin account at startup, but only on a
	// deployment that has no accounts at all. It exists for unattended
	// installs; the normal path is the first-run screen, which does not leave
	// a password sitting in an environment variable.
	AdminPassword string

	// RunMigrations applies any pending schema migrations at startup. On by
	// default so that a fresh deployment needs no extra step; set
	// GAMELOG_MIGRATE=false to take control of when the schema changes.
	RunMigrations bool

	// Grace period for in-flight requests to finish on SIGINT/SIGTERM.
	ShutdownTimeout time.Duration

	// ImagesDir is where uploaded cover images are stored, content-addressed
	// by the sha256 of their bytes. Local disk rather than object storage for
	// now: S3-compatible storage is a later step, not a v1 requirement.
	ImagesDir string
}

// DSN returns the connection string for the MySQL/MariaDB driver.
func (c Config) DSN() string {
	return fmt.Sprintf(
		// clientFoundRows makes an UPDATE report the rows it matched rather
		// than the rows it changed, so that writing a record with the values
		// it already has is not mistaken for a missing record.
		"%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=true&loc=UTC&clientFoundRows=true",
		c.DBUser, c.DBPassword, c.DBHost, c.DBPort, c.DBName,
	)
}

// Load reads the configuration from the environment, applying defaults meant
// for local development (the same ones compose.override.yaml exposes).
func Load() (Config, error) {
	port, err := envInt("GAMELOG_PORT", 8080)
	if err != nil {
		return Config{}, err
	}

	dbPort, err := envInt("GAMELOG_DB_PORT", 3306)
	if err != nil {
		return Config{}, err
	}

	runMigrations, err := envBool("GAMELOG_MIGRATE", true)
	if err != nil {
		return Config{}, err
	}

	docsEnabled, err := envBool("GAMELOG_DOCS", true)
	if err != nil {
		return Config{}, err
	}

	sessionLifetime, err := envDuration("GAMELOG_SESSION_LIFETIME", 365*24*time.Hour)
	if err != nil {
		return Config{}, err
	}

	secureCookie, err := envBool("GAMELOG_SECURE_COOKIE", false)
	if err != nil {
		return Config{}, err
	}

	return Config{
		Port:            port,
		DBHost:          env("GAMELOG_DB_HOST", "127.0.0.1"),
		DBPort:          dbPort,
		DBUser:          env("GAMELOG_DB_USER", "gamelog"),
		DBPassword:      env("GAMELOG_DB_PASSWORD", "gamelog"),
		DBName:          env("GAMELOG_DB_NAME", "gamelog"),
		DocsEnabled:     docsEnabled,
		RunMigrations:   runMigrations,
		SessionLifetime: sessionLifetime,
		SecureCookie:    secureCookie,
		AdminPassword:   env("GAMELOG_ADMIN_PASSWORD", ""),
		ShutdownTimeout: 10 * time.Second,
		ImagesDir:       env("GAMELOG_IMAGES_DIR", "./data/images"),
	}, nil
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %q is not a valid integer", key, raw)
	}
	return v, nil
}

func envDuration(key string, fallback time.Duration) (time.Duration, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return fallback, nil
	}
	v, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %q is not a valid duration, such as \"720h\"", key, raw)
	}
	if v <= 0 {
		return 0, fmt.Errorf("%s: %q must be positive", key, raw)
	}
	return v, nil
}

func envBool(key string, fallback bool) (bool, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s: %q is not a valid boolean", key, raw)
	}
	return v, nil
}
