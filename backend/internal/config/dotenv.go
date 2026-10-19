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
// in front, a value optionally wrapped in single or double quotes, which are
// dropped, and a comment after an unquoted value (see parseValue). There is
// no variable expansion and no multi-line value.
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
		values[key] = parseValue(value)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}
	return values, nil
}

// parseValue reads what follows the = of a line, the way Docker Compose
// does, so that the one file can serve both. A value in single or double
// quotes is whatever is between them, # included, and anything after the
// closing quote is ignored. An unquoted value ends at a # preceded by a space
// or a tab, which starts a comment: "8080 # api" is 8080, while "pa#ss"
// keeps its #.
func parseValue(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') {
		if end := strings.IndexByte(value[1:], value[0]); end >= 0 {
			return value[1 : end+1]
		}
	}
	for i := 1; i < len(value); i++ {
		if value[i] == '#' && (value[i-1] == ' ' || value[i-1] == '\t') {
			return strings.TrimSpace(value[:i])
		}
	}
	return value
}
