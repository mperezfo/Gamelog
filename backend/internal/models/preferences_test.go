package models

import (
	"reflect"
	"slices"
	"testing"
)

func TestPreferencesNormaliseFillsInDefaultsAndDropsUnknownValues(t *testing.T) {
	got := Preferences{Theme: "dark", DateFormat: "julian", CalendarView: ""}.Normalise()
	want := Preferences{Theme: "dark", DateFormat: "long", GamesView: "table", CalendarView: "release", SearchHidden: []string{}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Normalise() = %+v, want %+v", got, want)
	}
}

func TestPreferencesNormaliseKeepsWhatAListKnows(t *testing.T) {
	for _, tc := range []struct {
		hidden []string
		want   []string
	}{
		{nil, []string{}},
		{[]string{"genres", "series", "genres", "games"}, []string{"genres", "games"}},
		// Hiding every kind would leave nothing to search.
		{[]string{"games", "developers", "publishers", "platforms", "genres"}, []string{}},
	} {
		got := Preferences{SearchHidden: tc.hidden}.Normalise().SearchHidden
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("Normalise() of search_hidden %v = %v, want %v", tc.hidden, got, tc.want)
		}
	}
}

func TestPreferencesValidateSkipsWhatIsNotSet(t *testing.T) {
	if err := (Preferences{GamesView: "grid"}).Validate(); err != nil {
		t.Errorf("Validate() of one valid preference = %v, want nil", err)
	}
	if err := (Preferences{}).Validate(); err != nil {
		t.Errorf("Validate() of nothing = %v, want nil", err)
	}
	if err := (Preferences{Theme: "sepia"}).Validate(); err == nil {
		t.Error("Validate() of an unknown theme = nil, want an error")
	}
	if err := (Preferences{SearchHidden: []string{}}).Validate(); err != nil {
		t.Errorf("Validate() of nothing hidden = %v, want nil", err)
	}
	for _, hidden := range [][]string{
		{"series"},
		{"games", "games"},
		{"games", "developers", "publishers", "platforms", "genres"},
	} {
		if err := (Preferences{SearchHidden: hidden}).Validate(); err == nil {
			t.Errorf("Validate() of search_hidden %v = nil, want an error", hidden)
		}
	}
}

// Every preference's default is one of its own values, and every field of
// Preferences is described.
func TestPreferenceDefinitionsAreComplete(t *testing.T) {
	definitions := PreferenceDefinitions()
	if got, want := len(definitions), reflect.TypeFor[Preferences]().NumField(); got != want {
		t.Errorf("%d preferences are described, want one for each of the %d fields", got, want)
	}
	for _, preference := range definitions {
		if preference.List {
			if preference.MaxItems < 1 || preference.MaxItems > len(preference.Values) {
				t.Errorf("%s holds at most %d of its %d values", preference.Key, preference.MaxItems, len(preference.Values))
			}
			continue
		}
		if !slices.Contains(preference.Values, preference.Default) {
			t.Errorf("%s defaults to %q, which is not one of %v", preference.Key, preference.Default, preference.Values)
		}
	}
}
