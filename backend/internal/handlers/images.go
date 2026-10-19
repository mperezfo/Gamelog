package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/danielgtaylor/huma/v2"

	"github.com/mperezfo/gamelog/internal/imagefile"
)

// maxImageSize caps an upload before it is even read into memory. Cover art,
// not photo libraries: nothing legitimate needs more than this.
const maxImageSize = 8 << 20 // 8 MiB

type uploadImageInput struct {
	RawBody huma.MultipartFormFiles[struct {
		// AVIF is accepted and converted (see imagefile.Normalize). The
		// declared type only gets a file this far: what it really is comes
		// from its bytes, since a browser takes it from the file name.
		File huma.FormFile `form:"file" contentType:"image/png,image/jpeg,image/webp,image/gif,image/avif" required:"true"`
	}]
}

type uploadImageOutput struct {
	Body struct {
		// URL is a path relative to the API, ready to store as a game's
		// cover_image_url and to hand straight to an <img> tag.
		URL string `json:"url" doc:"Where the stored image is served from." example:"/api/images/3f2504e...jpg"`
	}
}

type importImageInput struct {
	Body struct {
		URL string `json:"url" format:"uri" maxLength:"2048" doc:"The image to copy, one of the url of a search-game-images result." example:"https://images.igdb.com/igdb/image/upload/t_original/co6bo0.jpg"`
	}
}

type getImageInput struct {
	Name string `path:"name" doc:"Filename returned by the upload." example:"3f2504e....jpg"`
	Size string `query:"size" enum:"sm,md" doc:"A smaller copy whose shorter side is 160 (sm) or 640 (md) pixels long, made on the first request for it. Left out, the original is served. An original that is already smaller is served as it is."`
}

type getImageOutput struct {
	ContentType string `header:"Content-Type"`
	// A year: the filename is content-addressed, so the same name never
	// points at different bytes and can be cached as if it never changes.
	// Private, as only a signed-in account can fetch it.
	CacheControl string `header:"Cache-Control"`
	Body         []byte
}

// registerImages registers cover image upload and retrieval.
//
// Notion-style external URLs are not supported here on purpose: a game's
// cover_image_url only ever points at a file this deployment has a copy of,
// so the library survives the day the original hosting page does not.
func registerImages(api huma.API, dir string, client *http.Client) {
	store := newImageStore(dir)
	importer := newImageImporter(client)

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
		OperationID: "import-image",
		Method:      http.MethodPost,
		Path:        "/api/images/import",
		Summary:     "Import a cover image from a search",
		Description: "Downloads an image found with search-game-images and stores it as upload-image does, " +
			"returning the URL to use as a game's cover_image_url. Only images hosted by IGDB or " +
			"SteamGridDB are accepted. One over 8 MiB, up to 32 MiB, is stored reduced: at most 3840 " +
			"pixels on its longer side, as a JPEG (a PNG if it has transparency).",
		Tags:          []string{"Images"},
		DefaultStatus: http.StatusCreated,
		Errors: []int{http.StatusUnauthorized, http.StatusUnprocessableEntity, http.StatusRequestEntityTooLarge,
			http.StatusFailedDependency},
	}, func(ctx context.Context, input *importImageInput) (*uploadImageOutput, error) {
		data, err := importer.download(ctx, input.Body.URL)
		if err != nil {
			return nil, err
		}
		return storeImage(dir, data)
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-image",
		Method:      http.MethodGet,
		Path:        "/api/images/{name}",
		Summary:     "Get a stored cover image",
		Description: "Serves an uploaded image, or with `size` a thumbnail of it for the views that show it small.",
		Tags:        []string{"Images"},
		// No Metadata: the default is AccessUser, same as everything else
		// about a library. The admin owns no games and has no reason to see
		// their covers either.
		Errors: []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, input *getImageInput) (*getImageOutput, error) {
		return getImage(store, input)
	})
}

func uploadImage(dir string, input *uploadImageInput) (*uploadImageOutput, error) {
	file := input.RawBody.Data().File
	if file.Size > maxImageSize {
		return nil, huma.Error413RequestEntityTooLarge("images are capped at 8 MiB")
	}

	data, err := io.ReadAll(io.LimitReader(file, maxImageSize+1))
	if err != nil {
		return nil, fmt.Errorf("reading the uploaded image: %w", err)
	}
	if len(data) > maxImageSize {
		return nil, huma.Error413RequestEntityTooLarge("images are capped at 8 MiB")
	}
	return storeImage(dir, data)
}

// storeImage keeps an image under dir, whether uploaded or imported, and
// returns the URL it is served from.
func storeImage(dir string, data []byte) (*uploadImageOutput, error) {
	data, ext, err := imagefile.Normalize(data)
	if errors.Is(err, imagefile.ErrTooManyPixels) {
		return nil, huma.Error413RequestEntityTooLarge("this image has too many pixels to be stored")
	}
	if err != nil {
		return nil, huma.Error422UnprocessableEntity(
			"unsupported image type: only PNG, JPEG, WEBP, GIF and AVIF are accepted")
	}

	// Content-addressed: identical bytes already on disk need no second write,
	// and two uploads of the same cover image collapse onto the same URL.
	name := imagefile.Name(data, ext)
	if err := imagefile.Store(filepath.Join(dir, name), data); err != nil {
		return nil, err
	}

	out := &uploadImageOutput{}
	out.Body.URL = imagefile.URLPrefix + name
	return out, nil
}

func getImage(store *imageStore, input *getImageInput) (*getImageOutput, error) {
	if !imagefile.ValidName(input.Name) {
		return nil, huma.Error404NotFound("no image with that name")
	}

	path := filepath.Join(store.dir, input.Name)
	if input.Size != "" {
		thumbnail, err := store.thumbnailPath(input.Name, input.Size)
		if os.IsNotExist(err) {
			return nil, huma.Error404NotFound("no image with that name")
		}
		if err != nil {
			return nil, err
		}
		path = thumbnail
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, huma.Error404NotFound("no image with that name")
		}
		return nil, fmt.Errorf("reading %s: %w", input.Name, err)
	}

	out := &getImageOutput{
		ContentType:  imagefile.ContentType(filepath.Ext(path)),
		CacheControl: "private, max-age=31536000, immutable",
		Body:         data,
	}
	return out, nil
}
