package models

import (
	"reflect"
	"slices"
	"testing"
)

func TestPreferencesNormaliseFillsInDefaultsAndDropsUnknownValues(t *testing.T) {
	got := Preferences{Theme: "dark", DateFormat: "julian", CalendarView: ""}.Normalise()
	want := Preferences{Theme: "dark", DateFormat: "long", GamesView: "table", CalendarView: "release"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Normalise() = %+v, want %+v", got, want)
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
}

// Every preference's default is one of its own values, and every field of
// Preferences is described.
func TestPreferenceDefinitionsAreComplete(t *testing.T) {
	definitions := PreferenceDefinitions()
	if got, want := len(definitions), reflect.TypeFor[Preferences]().NumField(); got != want {
		t.Errorf("%d preferences are described, want one for each of the %d fields", got, want)
	}
	for _, preference := range definitions {
		if !slices.Contains(preference.Values, preference.Default) {
			t.Errorf("%s defaults to %q, which is not one of %v", preference.Key, preference.Default, preference.Values)
		}
	}
}
