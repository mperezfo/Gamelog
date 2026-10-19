package imagefile

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"image/png"

	"golang.org/x/image/draw"
)

// MaxShrinkPixels caps the images Shrink takes on: decoded, one costs four
// bytes a pixel, so this keeps a single one under 160 MiB of memory. A
// banner or a cover is a fraction of it.
const MaxShrinkPixels = 40_000_000

// ErrTooManyPixels is returned for an image larger than MaxShrinkPixels.
var ErrTooManyPixels = errors.New("the image has too many pixels to be reduced")

// Shrink re-encodes an image to take less space: scaled down so that its
// longer side is at most maxSide pixels long, then encoded as a JPEG, or as
// a PNG when it has transparency to keep. It is for an image too heavy to
// store as it is, such as a SteamGridDB banner several times the size of the
// screen it is shown on.
//
// Unlike Normalize, it always re-encodes, which loses a little quality, and
// it reads no EXIF orientation: what it is given is artwork, not a phone
// photo.
func Shrink(data []byte, maxSide int) ([]byte, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, ErrUnsupported
	}
	// Checked before decoding: the header alone says how much memory the
	// pixels would take.
	if config.Width*config.Height > MaxShrinkPixels {
		return nil, ErrTooManyPixels
	}

	src, err := Decode(data)
	if err != nil {
		return nil, err
	}

	img := src
	bounds := src.Bounds()
	if width, height := bounds.Dx(), bounds.Dy(); max(width, height) > maxSide {
		longer := max(width, height)
		scaled := image.NewRGBA(image.Rect(0, 0,
			max(1, (width*maxSide+longer/2)/longer),
			max(1, (height*maxSide+longer/2)/longer),
		))
		draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, bounds, draw.Src, nil)
		img = scaled
	}

	var buf bytes.Buffer
	// Opaque or not as the original is, the way Normalize decides.
	if opaque, ok := src.(interface{ Opaque() bool }); ok && opaque.Opaque() {
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if err := encoder.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
