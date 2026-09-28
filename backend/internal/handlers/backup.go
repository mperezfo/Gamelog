package handlers

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/mperezfo/gamelog/internal/service"
)

// backupFilename is the library and account document inside a backup .zip.
// Everything else in the archive is an image, under images/.
const backupFilename = "gamelog.json"

// buildBackupZip writes a Document and its account as gamelog.json, plus
// every cover and avatar either of them names, into a .zip.
//
// An image the database still names but whose file is gone from disk is left
// out rather than failing the whole export: a missing cover is something to
// notice in the application, not a reason a backup of everything else cannot
// be made.
func buildBackupZip(document *service.Document, account service.AccountEntry, imagesDir string) ([]byte, error) {
	body, err := json.Marshal(service.BackupDocument{Document: document, Account: account})
	if err != nil {
		return nil, fmt.Errorf("encoding the backup document: %w", err)
	}

	var buf bytes.Buffer
	archive := zip.NewWriter(&buf)

	entry, err := archive.Create(backupFilename)
	if err != nil {
		return nil, err
	}
	if _, err := entry.Write(body); err != nil {
		return nil, err
	}

	for _, name := range referencedImages(document, account.AvatarURL) {
		if err := addImageToZip(archive, imagesDir, name); err != nil {
			return nil, err
		}
	}

	if err := archive.Close(); err != nil {
		return nil, fmt.Errorf("closing the backup archive: %w", err)
	}
	return buf.Bytes(), nil
}

func addImageToZip(archive *zip.Writer, imagesDir, name string) error {
	data, err := os.ReadFile(filepath.Join(imagesDir, name))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("reading %s: %w", name, err)
	}

	entry, err := archive.Create(path.Join("images", name))
	if err != nil {
		return err
	}
	_, err = entry.Write(data)
	return err
}

// referencedImages is the de-duplicated, content-addressed filenames a
// document's covers and an account's avatar point at.
func referencedImages(document *service.Document, avatarURL *string) []string {
	seen := map[string]struct{}{}
	var names []string

	add := func(url *string) {
		if url == nil {
			return
		}
		name, ok := strings.CutPrefix(*url, "/api/images/")
		if !ok || !imageFilename.MatchString(name) {
			return
		}
		if _, ok := seen[name]; ok {
			return
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}

	add(avatarURL)
	for _, game := range document.Games {
		add(game.CoverImageURL)
	}
	return names
}

// readBackupZip splits a backup .zip into the library to import, its account
// section, and the images it carries, keyed by the content-addressed name
// they are restored under.
func readBackupZip(data []byte) (service.ImportDocument, service.AccountEntry, map[string][]byte, error) {
	var empty service.ImportDocument
	var emptyAccount service.AccountEntry

	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return empty, emptyAccount, nil, fmt.Errorf("not a valid .zip file: %w", err)
	}

	body, err := readZipFile(archive, backupFilename)
	if err != nil {
		return empty, emptyAccount, nil, fmt.Errorf("the archive has no %s: %w", backupFilename, err)
	}

	var importDoc service.ImportDocument
	if err := json.Unmarshal(body, &importDoc); err != nil {
		return empty, emptyAccount, nil, fmt.Errorf("reading the library: %w", err)
	}

	var wrapper struct {
		Account service.AccountEntry `json:"account"`
	}
	if err := json.Unmarshal(body, &wrapper); err != nil {
		return empty, emptyAccount, nil, fmt.Errorf("reading the account: %w", err)
	}
	if err := wrapper.Account.Validate(); err != nil {
		return empty, emptyAccount, nil, err
	}

	images := map[string][]byte{}
	for _, file := range archive.File {
		name, ok := strings.CutPrefix(file.Name, "images/")
		if !ok || name == "" || !imageFilename.MatchString(name) {
			continue
		}

		content, err := readZipEntry(file)
		if err != nil {
			return empty, emptyAccount, nil, fmt.Errorf("reading %s: %w", file.Name, err)
		}
		images[name] = content
	}

	return importDoc, wrapper.Account, images, nil
}

func readZipFile(archive *zip.Reader, name string) ([]byte, error) {
	file, err := archive.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}

func readZipEntry(file *zip.File) ([]byte, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

// restoreImage writes one image from a backup into dir. The name is
// content-addressed and already validated by readBackupZip, so a file
// already on disk under it is left alone — its bytes are already right,
// exactly like a duplicate upload.
func restoreImage(dir, name string, data []byte) error {
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	return writeImageFile(path, bytes.NewReader(data))
}
