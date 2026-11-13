// Package config loads the server configuration from environment variables.
package config

import (
	"errors"
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

	// Grace period for in-flight requests to finish on SIGINT/SIGTERM. Under
	// the 10 seconds Docker waits after asking a container to stop, before it
	// kills what is left.
	ShutdownTimeout time.Duration

	// ImagesDir is where uploaded cover images are stored, content-addressed
	// by the sha256 of their bytes. Local disk rather than object storage for
	// now: S3-compatible storage is a later step, not a v1 requirement.
	ImagesDir string

	// IGDBClientID and IGDBClientSecret are the credentials of a Twitch
	// application (dev.twitch.tv/console), which is what IGDB authenticates
	// with. They are what the game form's Identify button looks games up
	// with: left out, the feature is simply not offered. Set both or neither.
	IGDBClientID     string
	IGDBClientSecret string

	// IGDBSearchLimit is how many games the Identify button's search offers
	// at most. Ten is a handful to find the right one among remakes and
	// remasters; IGDB itself returns at most 500 per query.
	IGDBSearchLimit int

	// SteamGridDBAPIKey is a SteamGridDB API key (steamgriddb.com, under the
	// account's preferences), which the cover image search looks games up
	// with alongside IGDB. Left out, SteamGridDB is simply not offered.
	SteamGridDBAPIKey string

	// BackupDaily, BackupWeekly and BackupMonthly are how many scheduled
	// backups to keep of each kind: the newest of each of the last that many
	// days, ISO weeks and months that have one. All zero, the default, takes
	// none at all.
	BackupDaily   int
	BackupWeekly  int
	BackupMonthly int
	// BackupDir is where scheduled backups are stored, in a directory per
	// account.
	BackupDir string
}

// BackupsEnabled reports whether backups are taken on a schedule: whenever
// any of them is to be kept.
func (c Config) BackupsEnabled() bool {
	return c.BackupDaily > 0 || c.BackupWeekly > 0 || c.BackupMonthly > 0
}

// maxIGDBSearchLimit is the most games IGDB returns for one query.
const maxIGDBSearchLimit = 500

// IGDBEnabled reports whether IGDB credentials are configured.
func (c Config) IGDBEnabled() bool {
	return c.IGDBClientID != "" && c.IGDBClientSecret != ""
}

// SteamGridDBEnabled reports whether a SteamGridDB API key is configured.
func (c Config) SteamGridDBEnabled() bool {
	return c.SteamGridDBAPIKey != ""
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
//
// A variable the environment leaves unset, or sets empty, is also looked up in
// the .env file at dotEnvPath, when there is one, so that a development setup
// can keep its settings in a file instead of exporting them in every terminal
// (see dotenv.go). The environment always wins over the file.
func Load(dotEnvPath string) (Config, error) {
	file, err := readDotEnv(dotEnvPath)
	if err != nil {
		return Config{}, err
	}
	src := source{file: file}
	port, err := src.integer("GAMELOG_PORT", 8080)
	if err != nil {
		return Config{}, err
	}

	dbPort, err := src.integer("GAMELOG_DB_PORT", 3306)
	if err != nil {
		return Config{}, err
	}

	runMigrations, err := src.boolean("GAMELOG_MIGRATE", true)
	if err != nil {
		return Config{}, err
	}

	docsEnabled, err := src.boolean("GAMELOG_DOCS", true)
	if err != nil {
		return Config{}, err
	}

	sessionLifetime, err := src.duration("GAMELOG_SESSION_LIFETIME", 365*24*time.Hour)
	if err != nil {
		return Config{}, err
	}

	secureCookie, err := src.boolean("GAMELOG_SECURE_COOKIE", false)
	if err != nil {
		return Config{}, err
	}

	igdbClientID := src.text("GAMELOG_IGDB_CLIENT_ID", "")
	igdbClientSecret := src.text("GAMELOG_IGDB_CLIENT_SECRET", "")
	// One without the other is a deployment that meant to turn IGDB on and
	// got it half right: failing here says so, where quietly leaving the
	// feature off would only show as a missing button.
	if (igdbClientID == "") != (igdbClientSecret == "") {
		return Config{}, errors.New("GAMELOG_IGDB_CLIENT_ID and GAMELOG_IGDB_CLIENT_SECRET must be set together")
	}

	igdbSearchLimit, err := src.integer("GAMELOG_IGDB_SEARCH_LIMIT", 10)
	if err != nil {
		return Config{}, err
	}
	if igdbSearchLimit < 1 || igdbSearchLimit > maxIGDBSearchLimit {
		return Config{}, fmt.Errorf("GAMELOG_IGDB_SEARCH_LIMIT: %d must be between 1 and %d", igdbSearchLimit, maxIGDBSearchLimit)
	}

	var retention [3]int
	for i, key := range []string{"GAMELOG_BACKUP_DAILY", "GAMELOG_BACKUP_WEEKLY", "GAMELOG_BACKUP_MONTHLY"} {
		retention[i], err = src.integer(key, 0)
		if err != nil {
			return Config{}, err
		}
		if retention[i] < 0 {
			return Config{}, fmt.Errorf("%s: %d must be 0 or more", key, retention[i])
		}
	}

	return Config{
		Port:            port,
		DBHost:          src.text("GAMELOG_DB_HOST", "127.0.0.1"),
		DBPort:          dbPort,
		DBUser:          src.text("GAMELOG_DB_USER", "gamelog"),
		DBPassword:      src.text("GAMELOG_DB_PASSWORD", "gamelog"),
		DBName:          src.text("GAMELOG_DB_NAME", "gamelog"),
		DocsEnabled:     docsEnabled,
		RunMigrations:   runMigrations,
		SessionLifetime: sessionLifetime,
		SecureCookie:    secureCookie,
		AdminPassword:   src.text("GAMELOG_ADMIN_PASSWORD", ""),
		ShutdownTimeout: 8 * time.Second,
		ImagesDir:       src.text("GAMELOG_IMAGES_DIR", "./data/images"),

		IGDBClientID:     igdbClientID,
		IGDBClientSecret: igdbClientSecret,
		IGDBSearchLimit:  igdbSearchLimit,

		SteamGridDBAPIKey: src.text("GAMELOG_STEAMGRIDDB_API_KEY", ""),

		BackupDaily:   retention[0],
		BackupWeekly:  retention[1],
		BackupMonthly: retention[2],
		BackupDir:     src.text("GAMELOG_BACKUP_DIR", "./data/backups"),
	}, nil
}

// source is where a variable's value comes from: the environment first, then
// the .env file.
type source struct {
	file map[string]string
}

// lookup returns the variable's value, or "" when neither the environment nor
// the file sets it. An empty value counts as unset, the same as everywhere
// else in this package.
func (s source) lookup(key string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return s.file[key]
}

func (s source) text(key, fallback string) string {
	if v := s.lookup(key); v != "" {
		return v
	}
	return fallback
}

func (s source) integer(key string, fallback int) (int, error) {
	raw := s.lookup(key)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %q is not a valid integer", key, raw)
	}
	return v, nil
}

func (s source) duration(key string, fallback time.Duration) (time.Duration, error) {
	raw := s.lookup(key)
	if raw == "" {
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

func (s source) boolean(key string, fallback bool) (bool, error) {
	raw := s.lookup(key)
	if raw == "" {
		return fallback, nil
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s: %q is not a valid boolean", key, raw)
	}
	return v, nil
}
