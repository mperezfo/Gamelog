#!/bin/sh
# Regenerates the PWA icons in frontend/public/icons from frontend/assets/logo.png.
#
# The source is a 1024px square: the logo mark on the dark theme's canvas
# colour. The mark covers only the central ~42%, well inside the 80% circle
# that Android guarantees never to crop, so the same artwork serves both the
# "any" icons and the "maskable" one.
#
# Usage: scripts/generate-icons.sh   (needs ImageMagick)

set -eu

cd "$(dirname "$0")/.."

src=frontend/assets/logo.png
out=frontend/public/icons

mkdir -p "$out"
magick "$src" -resize 192x192 "$out/icon-192.png"
magick "$src" -resize 512x512 "$out/icon-512.png"
magick "$src" -resize 512x512 "$out/icon-maskable-512.png"
