package imagefile

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	"github.com/gen2brain/avif"
)

// square is a size x size image of one colour.
func square(size int, c color.NRGBA) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := range size {
		for x := range size {
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encoding the test JPEG: %v", err)
	}
	return buf.Bytes()
}

func encodeAVIF(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := avif.Encode(&buf, img, avif.Options{Quality: 80, Speed: 10}); err != nil {
		t.Fatalf("encoding the test AVIF: %v", err)
	}
	return buf.Bytes()
}

var red = color.NRGBA{R: 255, A: 255}

func TestSniffJudgesTheBytesNotTheName(t *testing.T) {
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, square(4, red)); err != nil {
		t.Fatal(err)
	}

	cases := map[string]struct {
		data []byte
		want Format
	}{
		"jpeg":  {encodeJPEG(t, square(4, red)), JPEG},
		"png":   {pngData.Bytes(), PNG},
		"gif":   {[]byte("GIF89a\x01\x00\x01\x00"), GIF},
		"webp":  {[]byte("RIFF\x00\x00\x00\x00WEBPVP8 "), WebP},
		"avif":  {encodeAVIF(t, square(4, red)), AVIF},
		"text":  {[]byte("not an image at all"), Unknown},
		"empty": {nil, Unknown},
		"ftyp mp4": {
			[]byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"), Unknown,
		},
	}
	for name, tc := range cases {
		if got := Sniff(tc.data); got != tc.want {
			t.Errorf("%s: Sniff = %q, want %q", name, got, tc.want)
		}
	}
}

// A file whose major brand is the generic "mif1" names AVIF among its
// compatible brands only, and is AVIF all the same.
func TestSniffFindsAVIFAmongTheCompatibleBrands(t *testing.T) {
	data := []byte("\x00\x00\x00\x1cftypmif1\x00\x00\x00\x00mif1avifmiaf")
	if got := Sniff(data); got != AVIF {
		t.Errorf("Sniff = %q, want avif", got)
	}
}

func TestNormalizeKeepsAReadableImageByteForByte(t *testing.T) {
	original := encodeJPEG(t, square(8, red))

	data, ext, err := Normalize(original)
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if !bytes.Equal(data, original) {
		t.Error("a JPEG was re-encoded instead of kept as it was")
	}
	if ext != ".jpg" {
		t.Errorf("ext = %q, want .jpg", ext)
	}
}

func TestNormalizeConvertsAnOpaqueAVIFToJPEG(t *testing.T) {
	data, ext, err := Normalize(encodeAVIF(t, square(16, red)))
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if ext != ".jpg" || Sniff(data) != JPEG {
		t.Fatalf("got %s bytes as %q, want a JPEG as .jpg", Sniff(data), ext)
	}

	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding the result: %v", err)
	}
	if got := img.Bounds().Dx(); got != 16 {
		t.Errorf("width = %d, want the original 16", got)
	}
	if r, _, b, _ := img.At(8, 8).RGBA(); r < 0xc000 || b > 0x4000 {
		t.Error("the converted image is not the red it started as")
	}
}

func TestNormalizeConvertsATransparentAVIFToPNG(t *testing.T) {
	data, ext, err := Normalize(encodeAVIF(t, square(16, color.NRGBA{R: 255, A: 64})))
	if err != nil {
		t.Fatalf("Normalize: %v", err)
	}
	if ext != ".png" || Sniff(data) != PNG {
		t.Errorf("got %s bytes as %q, want a PNG to keep the transparency", Sniff(data), ext)
	}
}

func TestNormalizeRejectsWhatItCannotRead(t *testing.T) {
	if _, _, err := Normalize([]byte("not an image at all")); err == nil {
		t.Error("Normalize accepted bytes that are not an image")
	}
}

func TestValidName(t *testing.T) {
	sum := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	for name, want := range map[string]bool{
		sum + ".jpg":         true,
		sum + ".webp":        true,
		sum + ".avif":        false,
		"../" + sum + ".png": false,
		sum[:10] + ".png":    false,
		"thumbs":             false,
	} {
		if got := ValidName(name); got != want {
			t.Errorf("ValidName(%q) = %v, want %v", name, got, want)
		}
	}
}
