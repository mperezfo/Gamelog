package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

// importTimeout bounds the download of an imported image. Like searchTimeout,
// it stays under the frontend's own wait for an answer.
const importTimeout = 8 * time.Second

// importHosts are the only hosts an image is imported from: those the image
// search returns images on. Anything else is turned down, so that the
// operation cannot be used to make the server fetch an arbitrary address,
// such as one on its own network.
var importHosts = []string{
	"images.igdb.com",
	// SteamGridDB serves its images from a CDN under its own domain, which
	// has had more than one name over time.
	"*.steamgriddb.com",
}

// importHostAllowed reports whether u is an HTTPS URL on one of importHosts.
func importHostAllowed(u *url.URL) bool {
	if u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, allowed := range importHosts {
		if suffix, ok := strings.CutPrefix(allowed, "*"); ok {
			if strings.HasSuffix(host, suffix) {
				return true
			}
		} else if host == allowed {
			return true
		}
	}
	return false
}

// errImportRedirect is a redirect off importHosts, which is not followed.
var errImportRedirect = errors.New("redirected off the allowed hosts")

// imageImporter downloads images to import.
type imageImporter struct {
	client *http.Client
}

// newImageImporter builds an importer around client, or a client of its own
// when it is nil. Redirects are only followed within importHosts, whatever
// the client was configured to do.
func newImageImporter(client *http.Client) *imageImporter {
	own := http.Client{Timeout: importTimeout}
	if client != nil {
		own = *client
	}
	own.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if !importHostAllowed(req.URL) {
			return errImportRedirect
		}
		return nil
	}
	return &imageImporter{client: &own}
}

// download fetches the image at raw, up to maxImageSize, failing with the
// error the operation answers.
func (i *imageImporter) download(ctx context.Context, raw string) ([]byte, error) {
	u, err := url.Parse(raw)
	if err != nil || !importHostAllowed(u) {
		return nil, huma.Error422UnprocessableEntity("only images found with the image search can be imported")
	}

	ctx, cancel := context.WithTimeout(ctx, importTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, huma.Error422UnprocessableEntity("only images found with the image search can be imported")
	}

	resp, err := i.client.Do(req)
	if err != nil {
		slog.Warn("downloading an image to import failed", "url", raw, "error", err)
		return nil, errImportFailed(u)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		slog.Warn("downloading an image to import failed", "url", raw, "status", resp.StatusCode)
		return nil, errImportFailed(u)
	}
	if resp.ContentLength > maxImageSize {
		return nil, huma.Error413RequestEntityTooLarge("images are capped at 8 MiB")
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageSize+1))
	if err != nil {
		slog.Warn("downloading an image to import failed", "url", raw, "error", err)
		return nil, errImportFailed(u)
	}
	if len(data) > maxImageSize {
		return nil, huma.Error413RequestEntityTooLarge("images are capped at 8 MiB")
	}
	return data, nil
}

// errImportFailed is a download that failed through no fault of the request.
// A 424 rather than a 502, for the reason given in registerMetadata.
func errImportFailed(u *url.URL) error {
	return huma.NewError(http.StatusFailedDependency, fmt.Sprintf("the image could not be downloaded from %s", u.Hostname()))
}
