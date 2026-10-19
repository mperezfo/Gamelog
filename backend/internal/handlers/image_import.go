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

	"github.com/mperezfo/gamelog/internal/imagefile"
)

// importTimeout bounds the download of an imported image, up to 32 MiB from
// a CDN, leaving time to reduce it within the 30 seconds a request gets (see
// router.RequestTimeout).
const importTimeout = 20 * time.Second

// maxImportSize caps the download of an imported image, which can be larger
// than an upload: one over maxImageSize is reduced to importMaxSide before it
// is stored (see imageImporter.download), so that what is kept stays under
// the same cap as an upload. SteamGridDB's banners are what needs it: PNGs of
// up to 3840 pixels wide, some of them past 8 MiB.
const maxImportSize = 32 << 20 // 32 MiB

// importMaxSide is how long the longer side of a reduced image is at most:
// a 4K screen's width, more than any view of the app shows a cover at.
const importMaxSide = 3840

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

// download fetches the image at raw, up to maxImportSize, and reduces it
// when it is over maxImageSize, failing with the error the operation
// answers.
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
	if resp.ContentLength > maxImportSize {
		return nil, errImportTooLarge()
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImportSize+1))
	if err != nil {
		slog.Warn("downloading an image to import failed", "url", raw, "error", err)
		return nil, errImportFailed(u)
	}
	if len(data) > maxImportSize {
		return nil, errImportTooLarge()
	}
	if len(data) <= maxImageSize {
		return data, nil
	}

	shrunk, err := imagefile.Shrink(data, importMaxSide)
	if errors.Is(err, imagefile.ErrTooManyPixels) {
		return nil, errImportTooLarge()
	}
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(
			"unsupported image type: only PNG, JPEG, WEBP, GIF and AVIF are accepted")
	}
	// Still too heavy, which only a large image with transparency to keep
	// can be.
	if len(shrunk) > maxImageSize {
		return nil, errImportTooLarge()
	}
	slog.Info("reduced an imported image", "url", raw, "from", len(data), "to", len(shrunk))
	return shrunk, nil
}

func errImportTooLarge() error {
	return huma.Error413RequestEntityTooLarge("this image is too large to import, even reduced")
}

// errImportFailed is a download that failed through no fault of the request.
// A 424 rather than a 502, for the reason given in registerMetadata.
func errImportFailed(u *url.URL) error {
	return huma.NewError(http.StatusFailedDependency, fmt.Sprintf("the image could not be downloaded from %s", u.Hostname()))
}
