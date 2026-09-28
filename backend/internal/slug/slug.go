// Package slug turns a game's title into the URL-friendly form its detail
// page is reached by.
package slug

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// nonSlugRun matches any run of characters that do not belong in a slug, so
// it can be collapsed to a single hyphen in one pass.
var nonSlugRun = regexp.MustCompile(`[^a-z0-9]+`)

// diacritics strips combining marks after a title has been decomposed to
// NFD, which is what turns "é" into "e" instead of dropping it outright.
var diacritics = transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)

// Make turns a title into a slug: lowercase, ASCII, hyphen-separated, with
// diacritics folded rather than dropped ("Pokémon" -> "pokemon").
//
// It is not guaranteed unique on its own — two titles can fold to the same
// slug, and the same title can appear twice in a library. The repository is
// what makes the stored value unique, by appending "-2", "-3", ... the way a
// filesystem avoids overwriting a file of the same name.
func Make(title string) string {
	folded, _, err := transform.String(diacritics, title)
	if err != nil {
		folded = title
	}

	s := nonSlugRun.ReplaceAllString(strings.ToLower(folded), "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "game"
	}
	return s
}
