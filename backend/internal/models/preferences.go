package models

import (
	"fmt"
	"slices"
)

// Preferences are the display settings that travel with an account rather
// than staying in one browser: they follow it across devices, and are part
// of its backup. Embedded in User, so that they read as fields of the
// account in every response.
//
// Each one is a column of its own, whose CHECK keeps bad values out of the
// database, and is described once below, in preferences: what it takes and
// what it starts as. Adding one is a migration, a field here and its entry
// there.
type Preferences struct {
	Theme      string `gorm:"column:theme" json:"theme" doc:"Which theme the application renders in."`
	DateFormat string `gorm:"column:date_format" json:"date_format" doc:"How a date is written out: 'long' (Dec 31, 2023), 'ymd' (2023/12/31), 'dmy' (31/12/2023) or 'mdy' (12/31/2023)."`
	// GamesView is which layout the Games page opens in when its URL carries
	// no `view` of its own.
	GamesView string `gorm:"column:games_view" json:"games_view" doc:"Which layout the Games page opens in when its URL carries no view of its own."`
	// CalendarView is which dates the dashboard calendar opens on.
	CalendarView string `gorm:"column:calendar_view" json:"calendar_view" doc:"Which dates the dashboard calendar opens on: release dates or logged dates."`
}

// Preference describes one field of Preferences.
type Preference struct {
	// Key is its JSON name, the same as its column's.
	Key string
	// Values are the ones it takes.
	Values []string
	// Default is what an account starts with, and what a backup made before
	// the preference existed restores it to.
	Default string

	field func(*Preferences) *string
}

// preferences is every field of Preferences, in the order they are listed.
var preferences = []Preference{
	{
		Key:     "theme",
		Values:  []string{"light", "dark", "system"},
		Default: "system",
		field:   func(p *Preferences) *string { return &p.Theme },
	},
	{
		Key:     "date_format",
		Values:  []string{"long", "ymd", "dmy", "mdy"},
		Default: "long",
		field:   func(p *Preferences) *string { return &p.DateFormat },
	},
	{
		Key:     "games_view",
		Values:  []string{"table", "grid"},
		Default: "table",
		field:   func(p *Preferences) *string { return &p.GamesView },
	},
	{
		Key:     "calendar_view",
		Values:  []string{"release", "logged"},
		Default: "release",
		field:   func(p *Preferences) *string { return &p.CalendarView },
	},
}

// PreferenceDefinitions describes every preference, for the API to document
// and validate them without the models package depending on it.
func PreferenceDefinitions() []Preference {
	return slices.Clone(preferences)
}

// Normalise fills in a default for every preference left empty, or holding
// a value this build does not know: what a brand-new account starts with,
// and what restoring a backup made before a preference existed, or after
// one lost a value, needs.
func (p Preferences) Normalise() Preferences {
	for _, preference := range preferences {
		value := preference.field(&p)
		if !slices.Contains(preference.Values, *value) {
			*value = preference.Default
		}
	}
	return p
}

// Validate reports the first preference set to a value it does not take.
// One left empty is not set at all: an update changes only the ones it
// carries.
func (p Preferences) Validate() error {
	for _, preference := range preferences {
		value := *preference.field(&p)
		if value != "" && !slices.Contains(preference.Values, value) {
			return fmt.Errorf("%s cannot be %q", preference.Key, value)
		}
	}
	return nil
}
