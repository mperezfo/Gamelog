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

// Reserved reports whether a slug, unique or not, must not be stored as it
// is, because something else already answers at that address:
//
//   - all digits: a game is reached by its id or its slug alike (see
//     GameRepository.Resolve), and a number is read as the id, so a game
//     titled "1942" would open the game with id 1942.
//   - "new": the frontend's ?modal=new is the form for a new game, not the
//     game titled "New".
//
// The repository gives a reserved slug a suffix, the same as a taken one.
func Reserved(s string) bool {
	if s == "new" {
		return true
	}
	return s != "" && strings.Trim(s, "0123456789") == ""
}
