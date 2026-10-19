package handlers

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"golang.org/x/image/draw"

	// image.DecodeConfig below knows every format imagefile can read,
	// AVIF and WebP included, because importing it registers them.
	"github.com/mperezfo/gamelog/internal/imagefile"
)

// thumbnailSizes is every size GET /api/images/{name}?size= accepts, as the
// length in pixels of the shorter side of what it serves. The shorter side
// rather than the width: covers are cropped with object-fit: cover into
// portrait, square and landscape frames alike, and whichever frame it is,
// the shorter side is the one that has to fill it.
var thumbnailSizes = map[string]int{
	// Row icons, search results, the calendar and avatars: at most 64 CSS
	// pixels on a side, on a screen of up to 2.5x density.
	"sm": 160,
	// Cover cards and the board's landscape cards, up to about 250 CSS
	// pixels on the shorter side.
	"md": 640,
}

// thumbnailQuality is the JPEG quality thumbnails are encoded at. Past 80
// the files grow quickly for a difference nobody sees at card size.
const thumbnailQuality = 80

// imageStore is where uploaded images live, and the thumbnails made from
// them on the first request for each size.
type imageStore struct {
	dir string
	// slots bounds how many thumbnails are being made at once. The first
	// visit to a library asks for hundreds of them together, and a single 4K
	// cover is over 30 MiB once decoded.
	slots chan struct{}
}

func newImageStore(dir string) *imageStore {
	return &imageStore{dir: dir, slots: make(chan struct{}, runtime.NumCPU())}
}

// thumbnailPath returns the file to serve for name at size, making it first
// if this is the first request for it. An original that is already no
// bigger than size is served as it is: a thumbnail is never upscaled.
func (s *imageStore) thumbnailPath(name, size string) (string, error) {
	original := filepath.Join(s.dir, name)
	stem := strings.TrimSuffix(name, filepath.Ext(name))
	thumbDir := filepath.Join(s.dir, "thumbs", size)

	if path, ok := existingThumbnail(thumbDir, stem); ok {
		return path, nil
	}

	file, err := os.Open(original)
	if err != nil {
		return "", err
	}
	config, _, err := image.DecodeConfig(file)
	file.Close()
	if err != nil || min(config.Width, config.Height) <= thumbnailSizes[size] ||
		config.Width*config.Height > imagefile.MaxDecodePixels {
		// Nothing to gain from a thumbnail, a file the decoder does not
		// understand, which the browser may still manage to show, or one
		// too large to decode here without risking the server's memory.
		return original, nil
	}

	s.slots <- struct{}{}
	defer func() { <-s.slots }()

	// Another request may have made it while this one waited for a slot.
	if path, ok := existingThumbnail(thumbDir, stem); ok {
		return path, nil
	}

	data, err := os.ReadFile(original)
	if err != nil {
		return "", fmt.Errorf("reading %s: %w", name, err)
	}
	encoded, ext, err := makeThumbnail(data, thumbnailSizes[size])
	if err != nil {
		slog.Warn("serving the original in place of a thumbnail", "image", name, "size", size, "error", err)
		return original, nil
	}

	path := filepath.Join(thumbDir, stem+ext)
	if err := imagefile.WriteFile(path, bytes.NewReader(encoded)); err != nil {
		return "", err
	}
	return path, nil
}

// existingThumbnail looks for a thumbnail already made from stem, in either
// of the two formats makeThumbnail produces.
func existingThumbnail(thumbDir, stem string) (string, bool) {
	for _, ext := range []string{".jpg", ".png"} {
		path := filepath.Join(thumbDir, stem+ext)
		if _, err := os.Stat(path); err == nil {
			return path, true
		}
	}
	return "", false
}

// makeThumbnail scales an image down so its shorter side is short pixels
// long, and returns it encoded along with the extension it should be stored
// under: JPEG for an opaque image, PNG for one with transparency to keep.
// An animated GIF becomes its first frame.
func makeThumbnail(data []byte, short int) ([]byte, string, error) {
	src, err := imagefile.Decode(data)
	if err != nil {
		return nil, "", err
	}

	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	shorter := min(width, height)
	scaledWidth := max(1, (width*short+shorter/2)/shorter)
	scaledHeight := max(1, (height*short+shorter/2)/shorter)

	scaled := image.NewRGBA(image.Rect(0, 0, scaledWidth, scaledHeight))
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, bounds, draw.Src, nil)
	// Rotating the thumbnail rather than the original: it is the same
	// rotation, done on a fraction of the pixels.
	result := orient(scaled, jpegOrientation(data))

	var buf bytes.Buffer
	if opaque, ok := src.(interface{ Opaque() bool }); ok && opaque.Opaque() {
		if err := jpeg.Encode(&buf, result, &jpeg.Options{Quality: thumbnailQuality}); err != nil {
			return nil, "", fmt.Errorf("encoding the thumbnail: %w", err)
		}
		return buf.Bytes(), ".jpg", nil
	}
	if err := png.Encode(&buf, result); err != nil {
		return nil, "", fmt.Errorf("encoding the thumbnail: %w", err)
	}
	return buf.Bytes(), ".png", nil
}

// jpegOrientation reads the EXIF Orientation tag of a JPEG, 1 to 8, and
// returns 1 (as stored) for anything else or anything it cannot parse.
// Browsers honour the tag when showing the original, and Go's decoder
// ignores it, so a thumbnail of a phone photo would otherwise come out on
// its side.
func jpegOrientation(data []byte) int {
	if !bytes.HasPrefix(data, []byte("\xff\xd8")) {
		return 1
	}
	for pos := 2; pos+4 <= len(data); {
		if data[pos] != 0xff {
			return 1
		}
		marker := data[pos+1]
		length := int(binary.BigEndian.Uint16(data[pos+2:]))
		// Start of scan: past this point there are no more metadata segments.
		if marker == 0xda || length < 2 || pos+2+length > len(data) {
			return 1
		}
		segment := data[pos+4 : pos+2+length]
		if marker == 0xe1 && bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			return tiffOrientation(segment[6:])
		}
		pos += 2 + length
	}
	return 1
}

// tiffOrientation finds the Orientation tag in the first IFD of the TIFF
// structure an EXIF segment carries.
func tiffOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}

	ifd := int(order.Uint32(tiff[4:]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 1
	}
	count := int(order.Uint16(tiff[ifd:]))
	for i := range count {
		entry := ifd + 2 + i*12
		if entry+12 > len(tiff) {
			return 1
		}
		const orientationTag, shortType = 0x0112, 3
		if order.Uint16(tiff[entry:]) == orientationTag && order.Uint16(tiff[entry+2:]) == shortType {
			value := int(order.Uint16(tiff[entry+8:]))
			if value < 1 || value > 8 {
				return 1
			}
			return value
		}
	}
	return 1
}

// orient applies an EXIF orientation to img, returning it as it is meant to
// be seen.
func orient(img *image.RGBA, orientation int) *image.RGBA {
	if orientation <= 1 || orientation > 8 {
		return img
	}
	width, height := img.Bounds().Dx(), img.Bounds().Dy()

	// Orientations 5 to 8 turn the image a quarter, swapping its sides.
	outWidth, outHeight := width, height
	if orientation >= 5 {
		outWidth, outHeight = height, width
	}
	out := image.NewRGBA(image.Rect(0, 0, outWidth, outHeight))

	for y := range outHeight {
		for x := range outWidth {
			var sx, sy int
			switch orientation {
			case 2: // mirrored
				sx, sy = width-1-x, y
			case 3: // upside down
				sx, sy = width-1-x, height-1-y
			case 4: // mirrored upside down
				sx, sy = x, height-1-y
			case 5: // mirrored and turned
				sx, sy = y, x
			case 6: // turned a quarter clockwise to be upright
				sx, sy = y, height-1-x
			case 7: // mirrored and turned the other way
				sx, sy = width-1-y, height-1-x
			case 8: // turned a quarter anticlockwise to be upright
				sx, sy = width-1-y, x
			}
			out.SetRGBA(x, y, img.RGBAAt(sx, sy))
		}
	}
	return out
}
