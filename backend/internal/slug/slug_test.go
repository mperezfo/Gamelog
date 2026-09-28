package slug_test

import (
	"testing"

	"github.com/mperezfo/gamelog/internal/slug"
)

func TestMake(t *testing.T) {
	cases := map[string]string{
		"(the) Gnorp Apologue":    "the-gnorp-apologue",
		"Pokémon Legends: Arceus": "pokemon-legends-arceus",
		"DOOM Eternal":            "doom-eternal",
		"Marvel's Spider-Man 2":   "marvel-s-spider-man-2",
		"---":                     "game",
		"":                        "game",
		"NieR:Automata":           "nier-automata",
	}

	for title, want := range cases {
		if got := slug.Make(title); got != want {
			t.Errorf("Make(%q) = %q, want %q", title, got, want)
		}
	}
}
