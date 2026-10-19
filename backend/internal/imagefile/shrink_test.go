package imagefile

import (
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encoding: %v", err)
	}
	return buf.Bytes()
}

func TestShrinkScalesAnOpaqueImageToAJPEG(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 400, 100))
	for i := 3; i < len(img.Pix); i += 4 {
		img.Pix[i] = 0xff
	}

	out, err := Shrink(encodePNG(t, img), 200)
	if err != nil {
		t.Fatalf("Shrink: %v", err)
	}
	if Sniff(out) != JPEG {
		t.Errorf("format = %q, want a JPEG", Sniff(out))
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil || config.Width != 200 || config.Height != 50 {
		t.Errorf("size = %dx%d (%v), want 200x50", config.Width, config.Height, err)
	}
}

func TestShrinkKeepsTransparencyAsAPNG(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 100, 300))
	img.Set(0, 0, color.NRGBA{R: 255, A: 128})

	out, err := Shrink(encodePNG(t, img), 150)
	if err != nil {
		t.Fatalf("Shrink: %v", err)
	}
	if Sniff(out) != PNG {
		t.Errorf("format = %q, want a PNG", Sniff(out))
	}
	config, _, _ := image.DecodeConfig(bytes.NewReader(out))
	if config.Width != 50 || config.Height != 150 {
		t.Errorf("size = %dx%d, want 50x150", config.Width, config.Height)
	}
}

func TestShrinkLeavesTheSizeOfASmallImage(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 120, 80))
	for i := 3; i < len(img.Pix); i += 4 {
		img.Pix[i] = 0xff
	}

	out, err := Shrink(encodePNG(t, img), 3840)
	if err != nil {
		t.Fatalf("Shrink: %v", err)
	}
	config, _, _ := image.DecodeConfig(bytes.NewReader(out))
	if config.Width != 120 || config.Height != 80 {
		t.Errorf("size = %dx%d, want 120x80 as it was", config.Width, config.Height)
	}
}

// A header can claim any size: the pixels are never decoded past the cap.
func TestShrinkRefusesTooManyPixels(t *testing.T) {
	data := encodePNG(t, image.NewNRGBA(image.Rect(0, 0, 1, 1)))
	// The IHDR chunk follows the 8-byte signature: length, type, then the
	// width and height, and a CRC over the type and the data.
	binary.BigEndian.PutUint32(data[16:], 10000)
	binary.BigEndian.PutUint32(data[20:], 10000)
	binary.BigEndian.PutUint32(data[29:], crc32.ChecksumIEEE(data[12:29]))

	if _, err := Shrink(data, 3840); !errors.Is(err, ErrTooManyPixels) {
		t.Errorf("err = %v, want ErrTooManyPixels", err)
	}
}

func TestShrinkRefusesWhatIsNotAnImage(t *testing.T) {
	if _, err := Shrink([]byte("<!doctype html>"), 3840); !errors.Is(err, ErrUnsupported) {
		t.Errorf("err = %v, want ErrUnsupported", err)
	}
}
