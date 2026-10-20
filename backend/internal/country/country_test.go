package country

import "testing"

func TestEveryCountryOfISO3166IsKnown(t *testing.T) {
	if len(byNumeric) != 249 {
		t.Errorf("%d countries, want the 249 of ISO 3166-1", len(byNumeric))
	}
	if len(codes) != len(byNumeric) {
		t.Errorf("%d two-letter codes for %d numeric ones, want one each", len(codes), len(byNumeric))
	}
}

func TestFromNumeric(t *testing.T) {
	for _, tc := range []struct {
		numeric int
		want    string
		ok      bool
	}{
		{724, "ES", true},
		{392, "JP", true},
		{840, "US", true},
		{826, "GB", true},
		{8, "AL", true},
		{0, "", false},
		// The Soviet Union, long gone from ISO 3166-1.
		{810, "", false},
	} {
		got, ok := FromNumeric(tc.numeric)
		if got != tc.want || ok != tc.ok {
			t.Errorf("FromNumeric(%d) = %q, %v, want %q, %v", tc.numeric, got, ok, tc.want, tc.ok)
		}
	}
}

func TestNormalize(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		ok       bool
	}{
		{"ES", "ES", true},
		{" es ", "ES", true},
		{"XX", "XX", false},
		{"ESP", "ESP", false},
		{"", "", false},
	} {
		got, ok := Normalize(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("Normalize(%q) = %q, %v, want %q, %v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}
