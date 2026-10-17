package imagefile

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// URLPrefix is what a stored image's name is prefixed with to make the URL a
// game's cover or an account's picture points at.
const URLPrefix = "/api/images/"

// WriteFile writes to a temporary name in the same directory and renames it
// into place, so a request that fails partway through never leaves a
// truncated file at the URL another request just handed out.
func WriteFile(path string, src io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("creating the images directory: %w", err)
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".upload-*")
	if err != nil {
		return fmt.Errorf("creating a temporary file: %w", err)
	}
	defer os.Remove(tmp.Name())

	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return fmt.Errorf("writing the image: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("closing the image: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("finalising the image: %w", err)
	}
	return nil
}
