package config

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

// DotEnvFile is the file Load reads alongside the environment, relative to
// the directory the server runs from: backend/ under air or go run.
//
// It is for development. A deployment configures the process environment
// instead, and the image has no such file, so there it is simply not found.
const DotEnvFile = ".env"

// readDotEnv reads the variables a .env file sets. A missing file is not an
// error: it sets nothing. An empty path reads nothing either.
//
// The format is the common subset every .env reader agrees on, which is also
// what Docker Compose reads from the same kind of file: one KEY=VALUE per
// line, blank lines and lines starting with # ignored, an optional "export "
// in front, and a value optionally wrapped in single or double quotes, which
// are dropped. There is no variable expansion and no multi-line value.
func readDotEnv(path string) (map[string]string, error) {
	values := map[string]string{}
	if path == "" {
		return values, nil
	}

	file, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return values, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for number := 1; scanner.Scan(); number++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")

		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" || strings.ContainsAny(key, " \t") {
			return nil, fmt.Errorf("%s:%d: expected KEY=VALUE", path, number)
		}
		values[key] = unquote(strings.TrimSpace(value))
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	return values, nil
}

// unquote drops one pair of matching quotes around a value.
func unquote(value string) string {
	if len(value) >= 2 {
		first, last := value[0], value[len(value)-1]
		if first == last && (first == '"' || first == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}
