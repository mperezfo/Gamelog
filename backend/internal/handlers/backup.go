package handlers

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/mperezfo/gamelog/internal/imagefile"
	"github.com/mperezfo/gamelog/internal/service"
)

// maxBackupEntry caps one file of a backup once decompressed, and
// maxBackupContents all of them together, so that a small archive cannot
// decompress into more than the server can hold. An image is at most what an
// upload or an import stores, and the images, already compressed, take about
// as much room in the archive as out of it.
const (
	maxBackupEntry    = 64 << 20 // 64 MiB
	maxBackupContents = 4 * maxBackupSize
)

// errBackupTooLarge is a backup whose files decompress past those caps.
var errBackupTooLarge = errors.New("the backup decompresses into more than a backup can hold")

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

	body, err := readZipFile(archive, service.BackupDocumentName)
	if errors.Is(err, errBackupTooLarge) {
		return empty, emptyAccount, nil, err
	}
	if err != nil {
		return empty, emptyAccount, nil, fmt.Errorf("the archive has no %s: %w", service.BackupDocumentName, err)
	}
	total := len(body)

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
		if !ok || name == "" || !imagefile.ValidName(name) {
			continue
		}

		content, err := readZipEntry(file)
		if errors.Is(err, errBackupTooLarge) {
			return empty, emptyAccount, nil, err
		}
		if err != nil {
			return empty, emptyAccount, nil, fmt.Errorf("reading %s: %w", file.Name, err)
		}
		if total += len(content); total > maxBackupContents {
			return empty, emptyAccount, nil, errBackupTooLarge
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
	return readCapped(file)
}

func readZipEntry(file *zip.File) ([]byte, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return readCapped(reader)
}

// readCapped reads one decompressed file of a backup, up to maxBackupEntry.
// The sizes the archive declares are not trusted: they are whatever whoever
// made it wrote.
func readCapped(reader io.Reader) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxBackupEntry+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBackupEntry {
		return nil, errBackupTooLarge
	}
	return data, nil
}

// restoreImage writes one image from a backup into dir. The name is
// content-addressed and already validated by readBackupZip, so a file
// already on disk under it keeps its bytes, which are already right, exactly
// like a duplicate upload.
func restoreImage(dir, name string, data []byte) error {
	return imagefile.Store(filepath.Join(dir, name), data)
}
