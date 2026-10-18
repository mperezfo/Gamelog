package namematch

import "testing"

func TestBest(t *testing.T) {
	library := []Candidate{
		{1, "Sony"},
		{2, "Nintendo"},
		{3, "Capcom"},
		{4, "FromSoftware"},
		{5, "Square"},
		{6, "Epic Games"},
		{7, "Koei Tecmo"},
		{8, "Bandai Namco"},
		{9, "Bandai Namco Entertainment"},
	}

	tests := []struct {
		name       string
		wantID     uint64
		wantReason Reason
	}{
		{"Capcom Co., Ltd.", 3, ReasonNormalized},
		{"CAPCOM", 3, ReasonName},
		{"Sony Interactive Entertainment", 1, ReasonNormalized},
		{"Sony Interactive Entertainment America", 1, ReasonNormalized},
		{"FromSoftware, Inc.", 4, ReasonNormalized},
		{"From Software", 4, ReasonNormalized},
		{"Epic Games, Inc.", 6, ReasonNormalized},
		{"Nintendo EPD", 2, ReasonPrefix},
		{"Nintendo of America", 2, ReasonNormalized},
		{"Square Enix", 5, ReasonPrefix},
		{"Kōei Tecmo", 7, ReasonName},
		{"Koei Tecmo Games Co., Ltd.", 7, ReasonNormalized},
		// An identical name wins over a normalized one.
		{"Bandai Namco Entertainment", 9, ReasonName},
		// Among normalized matches, the shortest name wins.
		{"Bandai Namco Games", 8, ReasonNormalized},
	}
	for _, test := range tests {
		match, reason, ok := Best(test.name, library)
		if !ok {
			t.Errorf("Best(%q): no match, want %d (%s)", test.name, test.wantID, test.wantReason)
			continue
		}
		if match.ID != test.wantID || reason != test.wantReason {
			t.Errorf("Best(%q) = %d %q (%s), want %d (%s)",
				test.name, match.ID, match.Name, reason, test.wantID, test.wantReason)
		}
	}
}

func TestBestFindsNothing(t *testing.T) {
	library := []Candidate{{1, "Sony"}, {2, "Nintendo"}}

	for _, name := range []string{"Insomniac Games", "", "   ", "Entertainment Software"} {
		if match, reason, ok := Best(name, library); ok {
			t.Errorf("Best(%q) = %q (%s), want no match", name, match.Name, reason)
		}
	}
}

func TestBestWithANameOfNothingButGenericWords(t *testing.T) {
	// Nothing would be left of either name without its generic words, so the
	// words themselves are compared rather than two empty names.
	library := []Candidate{{1, "Digital Media"}, {2, "Interactive Studios"}}

	match, reason, ok := Best("Interactive Studios Ltd.", library)
	if !ok || match.ID != 2 || reason != ReasonNormalized {
		t.Errorf("Best = %q (%s, %v), want %q (normalized)", match.Name, reason, ok, "Interactive Studios")
	}
}

func TestNormalize(t *testing.T) {
	tests := map[string]string{
		"Capcom Co., Ltd.":               "capcom",
		"Sony Interactive Entertainment": "sony",
		"Koei Tecmo Games Co., Ltd.":     "koei tecmo",
		"Kōei Tecmo":                     "koei tecmo",
		"Square Enix K.K.":               "square enix",
		"Games":                          "games",
	}
	for name, want := range tests {
		if got := Normalize(name); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", name, got, want)
		}
	}
}
