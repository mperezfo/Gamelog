// Package namematch guesses which of a library's developers or publishers a
// company name from IGDB stands for.
//
// It only ever suggests: the game form shows the guess and lets the user take
// it, pick another record or create a new one. That is why it can afford a
// generous rule like a shared prefix ("Square Enix" suggests "Square"), which
// would be wrong to apply on its own.
package namematch

import (
	"cmp"
	"slices"
	"strings"
	"unicode"
)

// Reason is how a match was found, from the most to the least certain.
type Reason string

const (
	// ReasonName is the same name, ignoring case and accents: what the
	// database itself would consider the same record.
	ReasonName Reason = "name"
	// ReasonNormalized is the same name once company suffixes and generic
	// words are set aside ("Capcom Co., Ltd." and "Capcom"), or once spaces
	// are ("From Software" and "FromSoftware").
	ReasonNormalized Reason = "normalized"
	// ReasonPrefix is one name starting with the other, word for word
	// ("Nintendo EPD" and "Nintendo").
	ReasonPrefix Reason = "prefix"
)

// Candidate is a record a name can match.
type Candidate struct {
	ID   uint64
	Name string
}

// Best returns the candidate name most likely stands for, and how it was
// found. ok is false when nothing is close enough to suggest.
//
// Among candidates matching the same way, the shortest name wins, then the
// first in alphabetical order, so the same library always gives the same
// answer.
func Best(name string, candidates []Candidate) (match Candidate, reason Reason, ok bool) {
	target := analyse(name)
	if target.folded == "" {
		return Candidate{}, "", false
	}

	for _, level := range []Reason{ReasonName, ReasonNormalized, ReasonPrefix} {
		var found []Candidate
		for _, candidate := range candidates {
			if matches(level, target, analyse(candidate.Name)) {
				found = append(found, candidate)
			}
		}
		if len(found) > 0 {
			slices.SortFunc(found, func(a, b Candidate) int {
				return cmp.Or(cmp.Compare(len(a.Name), len(b.Name)), strings.Compare(a.Name, b.Name))
			})
			return found[0], level, true
		}
	}
	return Candidate{}, "", false
}

// Normalize returns the form two names are compared in at the normalized
// level: folded, without punctuation, company suffixes or generic words.
func Normalize(name string) string {
	return strings.Join(analyse(name).core, " ")
}

// analysed is a name broken down into the forms Best compares.
type analysed struct {
	// folded is the whole name in lower case without accents.
	folded string
	// words are its words, without punctuation.
	words []string
	// core is words without company suffixes and generic words. A name with
	// nothing else in it keeps its generic words, and one with not even those
	// keeps every word.
	core []string
}

func analyse(name string) analysed {
	folded := strings.Join(strings.Fields(fold(name)), " ")

	// Dots go without leaving a gap, so "K.K." and "Co." read as the words
	// "kk" and "co"; any other punctuation separates words.
	words := strings.FieldsFunc(strings.ReplaceAll(folded, ".", ""), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})

	core := without(words, legalForms, genericWords)
	if len(core) == 0 {
		core = without(words, legalForms)
	}
	if len(core) == 0 {
		core = words
	}

	return analysed{folded: folded, words: words, core: core}
}

func matches(level Reason, a, b analysed) bool {
	switch level {
	case ReasonName:
		return a.folded == b.folded
	case ReasonNormalized:
		return len(a.core) > 0 && slices.Equal(a.core, b.core) ||
			len(a.words) > 0 && strings.Join(a.words, "") == strings.Join(b.words, "")
	case ReasonPrefix:
		if len(a.core) == 0 || len(b.core) == 0 {
			return false
		}
		shorter, longer := a.core, b.core
		if len(shorter) > len(longer) {
			shorter, longer = longer, shorter
		}
		return slices.Equal(shorter, longer[:len(shorter)])
	default:
		return false
	}
}

// without returns words minus any found in one of the sets.
func without(words []string, sets ...map[string]bool) []string {
	kept := make([]string, 0, len(words))
	for _, word := range words {
		if !slices.ContainsFunc(sets, func(set map[string]bool) bool { return set[word] }) {
			kept = append(kept, word)
		}
	}
	return kept
}

// legalForms and genericWords say nothing about which company a name is: the
// legal form, the words a games company tends to carry in its name, and the
// regions its branches are named after.
var legalForms = map[string]bool{
	"inc": true, "incorporated": true, "ltd": true, "limited": true, "llc": true, "llp": true,
	"co": true, "corp": true, "corporation": true, "company": true, "plc": true,
	"gmbh": true, "ag": true, "sa": true, "sas": true, "sl": true, "srl": true, "spa": true,
	"bv": true, "nv": true, "ab": true, "oy": true, "pty": true, "pte": true, "kk": true,
}

var genericWords = map[string]bool{
	"entertainment": true, "interactive": true, "studio": true, "studios": true,
	"games": true, "game": true, "software": true, "digital": true,
	"productions": true, "publishing": true, "media": true, "group": true,
	"holdings": true, "international": true, "the": true, "of": true, "and": true,

	// Regions.
	"america": true, "americas": true, "europe": true, "japan": true, "usa": true,
}

// fold lower-cases s and strips the accents of the Latin letters company names
// are likely to carry, including the macrons of romanised Japanese ("Kōei").
// The database collation does the same for names it compares, so a name this
// treats as equal is one the database would have too.
func fold(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		if replacement, ok := accents[r]; ok {
			b.WriteString(replacement)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var accents = map[rune]string{
	'à': "a", 'á': "a", 'â': "a", 'ã': "a", 'ä': "a", 'å': "a", 'ā': "a", 'ą': "a", 'æ': "ae",
	'ç': "c", 'ć': "c", 'č': "c",
	'ď': "d", 'đ': "d",
	'è': "e", 'é': "e", 'ê': "e", 'ë': "e", 'ē': "e", 'ę': "e", 'ě': "e",
	'ì': "i", 'í': "i", 'î': "i", 'ï': "i", 'ī': "i",
	'ł': "l",
	'ñ': "n", 'ń': "n", 'ň': "n",
	'ò': "o", 'ó': "o", 'ô': "o", 'õ': "o", 'ö': "o", 'ø': "o", 'ō': "o", 'ő': "o", 'œ': "oe",
	'ř': "r",
	'ś': "s", 'š': "s", 'ß': "ss",
	'ť': "t",
	'ù': "u", 'ú': "u", 'û': "u", 'ü': "u", 'ū': "u", 'ů': "u", 'ű': "u",
	'ý': "y", 'ÿ': "y",
	'ź': "z", 'ż': "z", 'ž': "z",
}
