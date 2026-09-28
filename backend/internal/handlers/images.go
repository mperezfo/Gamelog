package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/danielgtaylor/huma/v2"
)

// maxImageSize caps an upload before it is even read into memory. Cover art,
// not photo libraries: nothing legitimate needs more than this.
const maxImageSize = 8 << 20 // 8 MiB

// imageExtensions is the allowlist of cover image types, and what each is
// stored as. Anything else is refused rather than guessed at.
var imageExtensions = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// imageFilename matches exactly what uploadImage produces: a sha256 hex digest
// plus one of the extensions above. GET /api/images/{name} checks against it
// before touching the filesystem, so a crafted name can never walk out of dir.
var imageFilename = regexp.MustCompile(`^[0-9a-f]{64}\.(png|jpg|webp|gif)$`)

type uploadImageInput struct {
	RawBody huma.MultipartFormFiles[struct {
		File huma.FormFile `form:"file" contentType:"image/png,image/jpeg,image/webp,image/gif" required:"true"`
	}]
}

type uploadImageOutput struct {
	Body struct {
		// URL is a path relative to the API, ready to store as a game's
		// cover_image_url and to hand straight to an <img> tag.
		URL string `json:"url" doc:"Where the stored image is served from." example:"/api/images/3f2504e...jpg"`
	}
}

type getImageInput struct {
	Name string `path:"name" doc:"Filename returned by the upload." example:"3f2504e....jpg"`
}

type getImageOutput struct {
	ContentType string `header:"Content-Type"`
	// A year: the filename is content-addressed, so the same name never
	// points at different bytes and can be cached as if it never changes.
	CacheControl string `header:"Cache-Control"`
	Body         []byte
}

// registerImages registers cover image upload and retrieval.
//
// Notion-style external URLs are not supported here on purpose: a game's
// cover_image_url only ever points at a file this deployment has a copy of,
// so the library survives the day the original hosting page does not.
func registerImages(api huma.API, dir string) {
	huma.Register(api, huma.Operation{
		OperationID: "upload-image",
		Method:      http.MethodPost,
		Path:        "/api/images",
		Summary:     "Upload a cover image",
		Description: "Stores an image and returns the URL to use as a game's cover_image_url. " +
			"Uploading the same bytes twice returns the same URL.",
		Tags:          []string{"Images"},
		DefaultStatus: http.StatusCreated,
		Errors:        []int{http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusRequestEntityTooLarge},
	}, func(ctx context.Context, input *uploadImageInput) (*uploadImageOutput, error) {
		return uploadImage(dir, input)
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-image",
		Method:      http.MethodGet,
		Path:        "/api/images/{name}",
		Summary:     "Get a stored cover image",
		Tags:        []string{"Images"},
		// No Metadata: the default is AccessUser, same as everything else
		// about a library. The admin owns no games and has no reason to see
		// their covers either.
		Errors: []int{http.StatusUnauthorized, http.StatusNotFound},
	}, func(ctx context.Context, input *getImageInput) (*getImageOutput, error) {
		return getImage(dir, input)
	})
}

func uploadImage(dir string, input *uploadImageInput) (*uploadImageOutput, error) {
	file := input.RawBody.Data().File

	ext, ok := imageExtensions[file.ContentType]
	if !ok {
		return nil, huma.Error422UnprocessableEntity(
			"unsupported image type: only PNG, JPEG, WEBP and GIF are accepted")
	}
	if file.Size > maxImageSize {
		return nil, huma.Error413RequestEntityTooLarge("images are capped at 8 MiB")
	}

	hash := sha256.New()
	limited := io.LimitReader(file, maxImageSize+1)
	if _, err := io.Copy(hash, limited); err != nil {
		return nil, fmt.Errorf("reading the uploaded image: %w", err)
	}

	name := hex.EncodeToString(hash.Sum(nil)) + ext
	path := filepath.Join(dir, name)

	// Content-addressed: identical bytes already on disk need no second write,
	// and two uploads of the same cover image collapse onto the same URL.
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return nil, fmt.Errorf("rewinding the uploaded image: %w", err)
		}
		if err := writeImageFile(path, file); err != nil {
			return nil, err
		}
	}

	out := &uploadImageOutput{}
	out.Body.URL = "/api/images/" + name
	return out, nil
}

// writeImageFile writes to a temporary name in the same directory and renames
// it into place, so a request that fails partway through never leaves a
// truncated file at the URL another request just handed out.
func writeImageFile(path string, src io.Reader) error {
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

func getImage(dir string, input *getImageInput) (*getImageOutput, error) {
	if !imageFilename.MatchString(input.Name) {
		return nil, huma.Error404NotFound("no image with that name")
	}

	data, err := os.ReadFile(filepath.Join(dir, input.Name))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, huma.Error404NotFound("no image with that name")
		}
		return nil, fmt.Errorf("reading %s: %w", input.Name, err)
	}

	contentType := "application/octet-stream"
	for mimeType, ext := range imageExtensions {
		if ext == filepath.Ext(input.Name) {
			contentType = mimeType
			break
		}
	}

	out := &getImageOutput{
		ContentType:  contentType,
		CacheControl: "public, max-age=31536000, immutable",
		Body:         data,
	}
	return out, nil
}
