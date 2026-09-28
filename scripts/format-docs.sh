#!/bin/sh
# Formats README.md and everything under docs/ with Prettier, so the Markdown
# keeps one style: one line per paragraph, left for the editor to wrap. The
# rules live in .prettierrc.json, which editors that format with Prettier
# pick up as well.
#
# Usage: scripts/format-docs.sh [--check]
#   --check  report unformatted files and fail instead of rewriting them (CI)

set -eu

cd "$(dirname "$0")/.."

mode=--write
if [ "${1:-}" = --check ]; then
	mode=--check
fi

# Pinned, so every machine and CI format the same way.
exec npx --yes prettier@3.9.9 "$mode" README.md 'docs/**/*.md'
