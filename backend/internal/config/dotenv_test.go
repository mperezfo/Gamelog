package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeDotEnv(t *testing.T, content string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("writing %s: %v", path, err)
	}
	return path
}

func TestLoadReadsADotEnvFile(t *testing.T) {
	path := writeDotEnv(t, `
# Comments and blank lines are ignored.

GAMELOG_PORT=9090
export GAMELOG_DB_NAME="from_file"
GAMELOG_DB_USER='quoted user'
GAMELOG_DB_HOST = spaced.example
GAMELOG_DOCS=
GAMELOG_SESSION_LIFETIME=720h # a comment, as Docker Compose allows
GAMELOG_DB_PASSWORD=pa#ss
GAMELOG_ADMIN_PASSWORD="quoted # kept" # but this goes
`)
	t.Setenv("GAMELOG_DB_NAME", "from_environment")
	// Empty in the environment counts as unset, so the file's value applies.
	t.Setenv("GAMELOG_DB_HOST", "")

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if cfg.Port != 9090 {
		t.Errorf("Port = %d, want 9090 from the file", cfg.Port)
	}
	if cfg.DBName != "from_environment" {
		t.Errorf("DBName = %q, want the environment to win over the file", cfg.DBName)
	}
	if cfg.DBUser != "quoted user" {
		t.Errorf("DBUser = %q, want the quotes dropped", cfg.DBUser)
	}
	if cfg.DBHost != "spaced.example" {
		t.Errorf("DBHost = %q, want %q", cfg.DBHost, "spaced.example")
	}
	if !cfg.DocsEnabled {
		t.Error("DocsEnabled = false, want an empty value to fall back to the default")
	}
	if cfg.SessionLifetime != 720*time.Hour {
		t.Errorf("SessionLifetime = %v, want 720h with the comment after it dropped", cfg.SessionLifetime)
	}
	if cfg.DBPassword != "pa#ss" {
		t.Errorf("DBPassword = %q, want a # inside a value kept", cfg.DBPassword)
	}
	if cfg.AdminPassword != "quoted # kept" {
		t.Errorf("AdminPassword = %q, want what is between the quotes", cfg.AdminPassword)
	}
}

func TestLoadWithoutADotEnvFile(t *testing.T) {
	cfg, err := Load(filepath.Join(t.TempDir(), "missing.env"))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Port != 8080 {
		t.Errorf("Port = %d, want the default 8080", cfg.Port)
	}
}

func TestLoadRejectsAMalformedDotEnvFile(t *testing.T) {
	path := writeDotEnv(t, "GAMELOG_PORT=9090\nnot a variable\n")

	_, err := Load(path)
	if err == nil || !strings.Contains(err.Error(), ":2:") {
		t.Errorf("err = %v, want one pointing at line 2", err)
	}
}
