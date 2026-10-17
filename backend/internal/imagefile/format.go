// Package imagefile is what the backend knows about the image files it
// stores: what type a file really is, judged from its bytes rather than its
// name, how to read it, and how to turn it into a type every part of the
// backend can read.
package imagefile

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"regexp"

	"github.com/gen2brain/avif"
	"golang.org/x/image/webp"
)

// Format is an image type, as its bytes say it is.
type Format string

const (
	JPEG    Format = "jpeg"
	PNG     Format = "png"
	GIF     Format = "gif"
	WebP    Format = "webp"
	AVIF    Format = "avif"
	Unknown Format = ""
)

// stored is every format kept as it is, with the extension it is stored
// under and the content type it is served with. Anything else is converted
// on the way in (see Normalize).
var stored = map[Format]struct{ ext, mime string }{
	JPEG: {".jpg", "image/jpeg"},
	PNG:  {".png", "image/png"},
	GIF:  {".gif", "image/gif"},
	WebP: {".webp", "image/webp"},
}

// namePattern matches exactly the names a stored image gets: the sha256 of
// its bytes plus one of the extensions above. Checked before a name ever
// touches the filesystem, so a crafted one can never walk out of the images
// directory.
var namePattern = regexp.MustCompile(`^[0-9a-f]{64}\.(png|jpg|webp|gif)$`)

// ErrUnsupported is returned for bytes that are not an image the backend can
// read.
var ErrUnsupported = errors.New("not a PNG, JPEG, WEBP, GIF or AVIF image")

// jpegQuality is what a converted image is encoded at: these are originals,
// shown full size in the cover editor, not thumbnails.
const jpegQuality = 90

// ValidName reports whether name is one a stored image could have.
func ValidName(name string) bool {
	return namePattern.MatchString(name)
}

// ContentType is what a stored file with this extension is served as.
func ContentType(ext string) string {
	for _, s := range stored {
		if s.ext == ext {
			return s.mime
		}
	}
	return "application/octet-stream"
}

// formatOf is the format a stored file's extension promises.
func formatOf(ext string) Format {
	for format, s := range stored {
		if s.ext == ext {
			return format
		}
	}
	return Unknown
}

// Sniff tells the type of an image from its first bytes.
func Sniff(data []byte) Format {
	switch {
	case bytes.HasPrefix(data, []byte("\xff\xd8")):
		return JPEG
	case bytes.HasPrefix(data, []byte("\x89PNG")):
		return PNG
	case bytes.HasPrefix(data, []byte("GIF8")):
		return GIF
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return WebP
	case isAVIF(data):
		return AVIF
	}
	return Unknown
}

// isAVIF looks for an AVIF brand in the ISO BMFF `ftyp` box an AVIF file
// opens with: as the major brand, or among the compatible ones, where a file
// whose major brand is the generic "mif1" lists it.
func isAVIF(data []byte) bool {
	if len(data) < 16 || string(data[4:8]) != "ftyp" {
		return false
	}
	size := int(binary.BigEndian.Uint32(data))
	if size < 16 || size > len(data) {
		return false
	}
	// The major brand at 8, its version at 12, then compatible brands.
	brands := append([]byte{}, data[8:12]...)
	brands = append(brands, data[16:size]...)
	for i := 0; i+4 <= len(brands); i += 4 {
		if brand := string(brands[i : i+4]); brand == "avif" || brand == "avis" {
			return true
		}
	}
	return false
}

// Decode reads an image of any format Sniff recognises. An animated GIF or
// AVIF gives its first frame.
func Decode(data []byte) (image.Image, error) {
	reader := bytes.NewReader(data)
	switch Sniff(data) {
	case JPEG:
		return jpeg.Decode(reader)
	case PNG:
		return png.Decode(reader)
	case GIF:
		return gif.Decode(reader)
	case WebP:
		return webp.Decode(reader)
	case AVIF:
		// AVIF carries its rotation in the container rather than in EXIF.
		return avif.Decode(reader, avif.Options{AutoRotate: true})
	}
	return nil, ErrUnsupported
}

// Normalize returns data as it should be stored, and the extension to store
// it under. A JPEG, PNG, GIF or WebP comes back byte for byte, whatever its
// file was called: re-encoding it would only lose quality. Anything else the
// backend can read (AVIF, in practice) is converted, to JPEG or, if it has
// transparency to keep, to PNG: the types every browser shows and the
// thumbnails can be made from.
func Normalize(data []byte) ([]byte, string, error) {
	if s, ok := stored[Sniff(data)]; ok {
		return data, s.ext, nil
	}

	img, err := Decode(data)
	if err != nil {
		return nil, "", err
	}

	var buf bytes.Buffer
	if opaque, ok := img.(interface{ Opaque() bool }); ok && opaque.Opaque() {
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
			return nil, "", err
		}
		return buf.Bytes(), stored[JPEG].ext, nil
	}
	if err := png.Encode(&buf, img); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), stored[PNG].ext, nil
}

// Name is what data is stored as: the sha256 of its bytes, so the same image
// always lands on the same name, plus ext.
func Name(data []byte, ext string) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]) + ext
}
