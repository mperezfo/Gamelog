#!/bin/sh
# Builds the README's hero image: a desktop screenshot as a window with
# rounded corners, with a phone mockup overlapping its bottom right corner,
# both with a soft shadow, on a transparent background.
#
# The desktop screenshot is scaled to 1728x1080, so any 16:10 capture fits
# (3456x2160 at twice the scale, for one). The phone mockup is a framed phone
# on a transparent canvas, such as docs/screenshots/mobile-mockups/*.png: the
# phone is found inside it by its outline, so the margin around it does not
# matter.
#
# The window's hairline border is white on a dark screenshot and black on a
# light one, told apart by "light" in the desktop file's name, so that it
# shows against GitHub's background in either theme.
#
# Usage: scripts/make-hero.sh <desktop.png> <mobile-mockup.png> [out.png]
#   out.png defaults to hero.png in the current directory
#
# Needs ImageMagick 7, and pngquant to compress the result (run through
# `nix shell` when it is not installed; left uncompressed without either).

set -eu

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
	echo "usage: $0 <desktop.png> <mobile-mockup.png> [out.png]" >&2
	exit 2
fi

desktop=$1
mobile=$2
out=${3:-hero.png}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# The window, and the phone's height in it.
w=1728
h=1080
radius=22
phone_height=940

case $(basename "$desktop") in
*light*) stroke='rgba(0,0,0,0.12)' ;;
*) stroke='rgba(255,255,255,0.14)' ;;
esac

magick "$desktop" -resize "${w}x${h}!" \
	\( +clone -alpha transparent -fill white -draw "roundrectangle 0,0,$((w - 1)),$((h - 1)),$radius,$radius" \) \
	-compose DstIn -composite -compose Over \
	-fill none -stroke "$stroke" -strokewidth 2 \
	-draw "roundrectangle 1,1,$((w - 2)),$((h - 2)),$radius,$radius" \
	"$tmp/desktop.png"

# The phone alone: the box of everything at least half opaque, which leaves
# out the mockup's own faint shadow, if it has one.
phone_box=$(magick "$mobile" -alpha extract -threshold 50% -format %@ info:)
magick "$mobile" -crop "$phone_box" +repage -resize "x$phone_height" "$tmp/phone.png"
phone_width=$(magick identify -format %w "$tmp/phone.png")

for part in desktop phone; do
	magick "$tmp/$part.png" \( +clone -background black -shadow 45x24+0+18 \) +swap \
		-background none -layers merge +repage "$tmp/$part-shadow.png"
done

# Over the window's bottom right corner: 55% of the phone's width inside it,
# and 150px of the phone below its bottom edge. Then trimmed to what shows,
# with 80px of space on top to keep clear of the text above it.
x=$((w - phone_width * 45 / 100))
y=$((h - phone_height + 150))
magick -size $((x + phone_width + 90))x$((y + phone_height + 90)) xc:none \
	"$tmp/desktop-shadow.png" -geometry +20+20 -composite \
	"$tmp/phone-shadow.png" -geometry "+$x+$y" -composite \
	-trim +repage -bordercolor none -border 8 \
	-background none -gravity north -splice 0x80 \
	"$out"

if command -v pngquant >/dev/null 2>&1; then
	pngquant=pngquant
elif command -v nix >/dev/null 2>&1; then
	pngquant='nix shell nixpkgs#pngquant -c pngquant'
else
	pngquant=
	echo "pngquant not found: $out is left uncompressed" >&2
fi
# Unquoted on purpose: the nix form is a command and its arguments.
[ -z "$pngquant" ] || $pngquant --force --ext .png --quality 75-92 --speed 1 --skip-if-larger "$out"

magick identify -format "$out: %wx%h, %b\n" "$out"
