package handlers

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// halves is a width x height image, red on its left half and blue on its
// right, so that a test can tell which way round a thumbnail came out.
func halves(width, height int, alpha uint8) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			c := color.NRGBA{R: 255, A: alpha}
			if x >= width/2 {
				c = color.NRGBA{B: 255, A: alpha}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatalf("encoding the test JPEG: %v", err)
	}
	return buf.Bytes()
}

// withOrientation inserts an EXIF segment carrying only an Orientation tag
// right after the JPEG's start-of-image marker, as a camera would write it.
func withOrientation(data []byte, orientation byte) []byte {
	tiff := []byte{
		'M', 'M', 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // header, IFD0 at 8
		0x00, 0x01, // one entry
		0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, // no next IFD
	}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	length := len(payload) + 2
	segment := append([]byte{0xff, 0xe1, byte(length >> 8), byte(length)}, payload...)

	out := append([]byte{}, data[:2]...)
	out = append(out, segment...)
	return append(out, data[2:]...)
}

func decodeThumbnail(t *testing.T, data []byte) image.Image {
	t.Helper()
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("decoding the thumbnail: %v", err)
	}
	return img
}

func isReddish(c color.Color) bool {
	r, _, b, _ := c.RGBA()
	return r > 0xc000 && b < 0x4000
}

func TestMakeThumbnailScalesTheShorterSide(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		width, height         int
		wantWidth, wantHeight int
	}{
		{"landscape", 2000, 1000, 320, 160},
		{"portrait", 900, 1200, 160, 213},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, ext, err := makeThumbnail(encodeJPEG(t, halves(tc.width, tc.height, 255)), 160)
			if err != nil {
				t.Fatalf("makeThumbnail: %v", err)
			}
			if ext != ".jpg" {
				t.Errorf("extension = %q, want .jpg for an opaque image", ext)
			}
			bounds := decodeThumbnail(t, data).Bounds()
			if bounds.Dx() != tc.wantWidth || bounds.Dy() != tc.wantHeight {
				t.Errorf("thumbnail is %dx%d, want %dx%d", bounds.Dx(), bounds.Dy(), tc.wantWidth, tc.wantHeight)
			}
		})
	}
}

func TestMakeThumbnailKeepsTransparency(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, halves(400, 400, 128)); err != nil {
		t.Fatalf("encoding the test PNG: %v", err)
	}

	data, ext, err := makeThumbnail(buf.Bytes(), 160)
	if err != nil {
		t.Fatalf("makeThumbnail: %v", err)
	}
	if ext != ".png" {
		t.Fatalf("extension = %q, want .png for an image with transparency", ext)
	}
	if _, _, _, a := decodeThumbnail(t, data).At(10, 10).RGBA(); a == 0xffff {
		t.Error("the thumbnail lost the original's transparency")
	}
}

func TestMakeThumbnailHonoursTheEXIFOrientation(t *testing.T) {
	// Stored on its side: 6 means it has to be turned a quarter clockwise,
	// which brings the red left half to the top.
	data, _, err := makeThumbnail(withOrientation(encodeJPEG(t, halves(400, 200, 255)), 6), 100)
	if err != nil {
		t.Fatalf("makeThumbnail: %v", err)
	}

	img := decodeThumbnail(t, data)
	bounds := img.Bounds()
	if bounds.Dx() != 100 || bounds.Dy() != 200 {
		t.Fatalf("thumbnail is %dx%d, want it upright at 100x200", bounds.Dx(), bounds.Dy())
	}
	if !isReddish(img.At(50, 10)) || isReddish(img.At(50, 190)) {
		t.Error("the thumbnail was not turned the way its EXIF orientation says")
	}
}

func TestThumbnailPathIsMadeOnceAndNeverUpscales(t *testing.T) {
	dir := t.TempDir()
	store := newImageStore(dir)

	large := strings.Repeat("a", 64) + ".jpg"
	if err := os.WriteFile(filepath.Join(dir, large), encodeJPEG(t, halves(1200, 800, 255)), 0o644); err != nil {
		t.Fatal(err)
	}
	small := strings.Repeat("b", 64) + ".jpg"
	if err := os.WriteFile(filepath.Join(dir, small), encodeJPEG(t, halves(120, 90, 255)), 0o644); err != nil {
		t.Fatal(err)
	}

	path, err := store.thumbnailPath(large, "sm")
	if err != nil {
		t.Fatalf("thumbnailPath: %v", err)
	}
	if want := filepath.Join(dir, "thumbs", "sm", large); path != want {
		t.Fatalf("thumbnail stored at %q, want %q", path, want)
	}

	// The second request is served the file the first one made.
	made, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	again, err := store.thumbnailPath(large, "sm")
	if err != nil || again != path {
		t.Fatalf("second thumbnailPath = %q, %v; want %q", again, err, path)
	}
	if after, _ := os.Stat(again); !after.ModTime().Equal(made.ModTime()) {
		t.Error("the thumbnail was made a second time")
	}

	path, err = store.thumbnailPath(small, "sm")
	if err != nil {
		t.Fatalf("thumbnailPath: %v", err)
	}
	if want := filepath.Join(dir, small); path != want {
		t.Errorf("an image smaller than the size was served from %q, want the original %q", path, want)
	}

	if _, err := store.thumbnailPath(strings.Repeat("c", 64)+".jpg", "sm"); !os.IsNotExist(err) {
		t.Errorf("thumbnailPath of a missing image: err = %v, want not-exist", err)
	}
}

// TestThumbnailPathServesTheOriginalPastThePixelCap: an image whose pixels
// would take more memory than the cap allows is not decoded for a thumbnail,
// however few bytes its file takes.
func TestThumbnailPathServesTheOriginalPastThePixelCap(t *testing.T) {
	dir := t.TempDir()
	store := newImageStore(dir)

	// One byte a pixel while encoding, and a uniform one compresses to a
	// few kilobytes.
	huge := image.NewPaletted(image.Rect(0, 0, 8000, 6000), color.Palette{color.Black})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, huge); err != nil {
		t.Fatal(err)
	}
	name := strings.Repeat("d", 64) + ".png"
	if err := os.WriteFile(filepath.Join(dir, name), encoded.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	path, err := store.thumbnailPath(name, "md")
	if err != nil {
		t.Fatalf("thumbnailPath: %v", err)
	}
	if want := filepath.Join(dir, name); path != want {
		t.Errorf("an image past the pixel cap was served from %q, want the original %q", path, want)
	}
}
