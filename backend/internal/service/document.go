// Package service holds the logic that does not belong to a single
// repository: for now, the JSON import and export of the whole library.
//
// Two rules shape the interchange format described in this file:
//
//   - Relations are written by name, never by id. An id is an implementation
//     detail of one database, while a name is what the user typed and what
//     another copy of Gamelog, a spreadsheet or a file written by hand can
//     carry. It also makes the format mergeable: importing the same file twice
//     updates the same records instead of duplicating them.
//   - Writing is canonical, reading is permissive. An export always emits the
//     shape below; an import also accepts the shapes a file converted from
//     Notion, from a spreadsheet or from another tracker arrives in, and says
//     in its answer everything it had to interpret.
package service

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
)

// FormatVersion is the version of the interchange format. Every export writes
// it; an import reads a document without it just as happily, since it is
// permissive enough not to need it. It exists so that a future incompatible
// change has something to key off.
const FormatVersion = 1

// Document is a whole library written in the interchange format: the body of
// an export, and the shape an import understands best.
//
// Every section is always present, empty when there is nothing in it, so that
// a file is predictable to read both for a program and for a person editing it
// by hand.
type Document struct {
	Version    int       `json:"version" doc:"Version of the interchange format." example:"1"`
	ExportedAt time.Time `json:"exported_at" doc:"When the export was produced."`

	Platforms  []LookupEntry `json:"platforms" doc:"Every platform in the library."`
	Genres     []LookupEntry `json:"genres" doc:"Every genre in the library."`
	Developers []LookupEntry `json:"developers" doc:"Every developer in the library."`
	Publishers []LookupEntry `json:"publishers" doc:"Every publisher in the library."`
	Games      []GameEntry   `json:"games" doc:"Every game in the library, with its relations written by name."`
}

// LookupEntry is a genre, developer, publisher or platform: the four entities
// that are nothing but a name, an icon and, for a platform only, a colour.
type LookupEntry struct {
	Name  string  `json:"name" doc:"Name of the record. Unique, compared ignoring case and accents." example:"Metroidvania"`
	Icon  *string `json:"icon" doc:"Emoji or short icon shown next to the name." example:"🗺️"`
	Color *string `json:"color,omitempty" doc:"Hex colour (\"#3b82f6\"). Only meaningful for a platform; always null for the other three." example:"#3b82f6"`
}

// GameEntry is one game, with its platform and its genres, developers and
// publishers named rather than numbered.
type GameEntry struct {
	Title         string   `json:"title" doc:"Title of the game." example:"Hollow Knight"`
	Status        string   `json:"status" doc:"Lifecycle stage: wishlist, pending, playing or played." example:"played"`
	Score         *float64 `json:"score" doc:"Personal score from 0 to 10, with one decimal. Null while the game is unplayed." example:"9.2"`
	Tagline       *string  `json:"tagline" doc:"Very short personal description." example:"Lonely bug, big map"`
	Notes         *string  `json:"notes" doc:"Free-form notes."`
	CoverImageURL *string  `json:"cover_image_url" doc:"URL of the cover image."`
	CoverFocalX   *float64 `json:"cover_focal_x" doc:"Horizontal focal point of the cover, from 0 to 1, used to crop it in portrait. Null centres it."`
	CoverFocalY   *float64 `json:"cover_focal_y" doc:"Vertical focal point of the cover, from 0 to 1, used to crop it in portrait. Null centres it."`
	CoverZoom     *float64 `json:"cover_zoom" doc:"Zoom applied to the cover in portrait, from 1 to 3. Null is no zoom."`
	ReleaseDate   *Date    `json:"release_date" doc:"Release date of the game."`
	LoggedDate    *Date    `json:"logged_date" doc:"When the game was started, logged or finished."`

	Platform   *string  `json:"platform" doc:"Name of the platform the game was played on." example:"Nintendo Switch"`
	Genres     []string `json:"genres" doc:"Names of the genres of the game."`
	Developers []string `json:"developers" doc:"Names of the developers of the game."`
	Publishers []string `json:"publishers" doc:"Names of the publishers of the game."`
}

// Date is a calendar date with no time and no zone, which is what the
// release_date and logged_date columns hold.
//
// It is written as YYYY-MM-DD rather than as an RFC 3339 instant on purpose: a
// release date has no hour, and an instant would drag a time zone into a file
// that is meant to be read and edited by a person.
type Date struct {
	// Time is the date at midnight UTC.
	Time time.Time
	// Blank reports that the document carried the field with an empty value.
	// On an import that clears the date, where an absent field leaves it
	// alone.
	Blank bool
}

// NewDate builds a Date from an instant, keeping only its calendar date.
func NewDate(t time.Time) Date {
	year, month, day := t.Date()
	return Date{Time: time.Date(year, month, day, 0, 0, 0, 0, time.UTC)}
}

// dateLayouts are the formats an import accepts, tried in this order.
//
// The slash-separated ones are read day first, as they are written in Spain
// and in most of Europe: 02/03/2024 is the second of March. A file written the
// other way round has to use the unambiguous YYYY-MM-DD.
var dateLayouts = []string{
	time.DateOnly, // 2006-01-02
	time.RFC3339,  // 2006-01-02T15:04:05Z07:00
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"02/01/2006",
	"2/1/2006",
	"02-01-2006",
	"January 2, 2006",
	"2 January 2006",
	"Jan 2, 2006",
}

// MarshalJSON writes the date as YYYY-MM-DD, or as null when there is none.
func (d Date) MarshalJSON() ([]byte, error) {
	if d.Blank || d.Time.IsZero() {
		return []byte("null"), nil
	}
	return json.Marshal(d.Time.Format(time.DateOnly))
}

// UnmarshalJSON reads any of the formats in dateLayouts, and treats an empty
// string as a date the document is deliberately clearing.
func (d *Date) UnmarshalJSON(data []byte) error {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	switch value := raw.(type) {
	case nil:
		*d = Date{Blank: true}
		return nil
	case string:
		text := strings.TrimSpace(value)
		if text == "" {
			*d = Date{Blank: true}
			return nil
		}
		for _, layout := range dateLayouts {
			parsed, err := time.Parse(layout, text)
			if err != nil {
				continue
			}
			*d = NewDate(parsed)
			return nil
		}
		return fmt.Errorf("%q is not a date this import understands; write it as 2006-01-02", text)
	default:
		return fmt.Errorf("a date has to be written as a string, not as %T", raw)
	}
}

// Schema documents the type for both directions at once.
//
// It deliberately does not use the "date" format of OpenAPI: Huma validates
// that format strictly, which would reject the very spellings the import goes
// out of its way to accept.
func (Date) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{
		Type:     huma.TypeString,
		Nullable: true,
		Title:    "Date",
		Description: "A calendar date. Always written as YYYY-MM-DD. On an import, " +
			"02/01/2006 (day first), 02-01-2006, 2 January 2006, January 2, 2006 and a " +
			"full RFC 3339 instant are accepted too, and an empty string clears the date.",
		Examples: []any{"2017-02-24"},
	}
}

// Number is a number read from either a JSON number or a string, which is how
// every value arrives in a file converted from a spreadsheet or from CSV.
type Number struct {
	// Value is the parsed number, meaningful only when Blank is false.
	Value float64
	// Blank reports that the document carried the field with an empty value,
	// which clears it rather than leaving it alone.
	Blank bool
}

// MarshalJSON writes the number, or null when the value is a blank.
func (n Number) MarshalJSON() ([]byte, error) {
	if n.Blank {
		return []byte("null"), nil
	}
	return json.Marshal(n.Value)
}

// UnmarshalJSON accepts a number, or a string holding one. A comma is read as
// a decimal separator, since that is how the number was typed in Spanish.
func (n *Number) UnmarshalJSON(data []byte) error {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	switch value := raw.(type) {
	case nil:
		*n = Number{Blank: true}
		return nil
	case float64:
		*n = Number{Value: value}
		return nil
	case string:
		text := strings.TrimSpace(value)
		if text == "" {
			*n = Number{Blank: true}
			return nil
		}
		parsed, err := strconv.ParseFloat(strings.Replace(text, ",", ".", 1), 64)
		if err != nil {
			return fmt.Errorf("%q is not a number", text)
		}
		*n = Number{Value: parsed}
		return nil
	default:
		return fmt.Errorf("a number has to be written as a number or as a string, not as %T", raw)
	}
}

// Schema documents both accepted spellings.
func (Number) Schema(huma.Registry) *huma.Schema {
	schema := &huma.Schema{
		Title:    "Number",
		Nullable: true,
		Description: "A number, written either as a JSON number or as a string, where a " +
			"comma counts as the decimal separator (\"9,2\"). An empty string clears the value.",
		OneOf: []*huma.Schema{
			{Type: huma.TypeNumber},
			{Type: huma.TypeString},
		},
		Examples: []any{9.2},
	}
	schema.PrecomputeMessages()
	return schema
}

// Names is a list of related records, written by name.
//
// An export always writes an array of strings. An import also takes a single
// string, a comma-separated one, and objects carrying a name — the three
// shapes a multi-value column turns into when it leaves another tool.
type Names []string

// UnmarshalJSON reads every accepted spelling of a list of names.
func (n *Names) UnmarshalJSON(data []byte) error {
	var raw any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	switch value := raw.(type) {
	case nil:
		*n = nil
		return nil
	case string:
		*n = splitNames(value)
		return nil
	case []any:
		names := make(Names, 0, len(value))
		for _, item := range value {
			name, err := itemName(item)
			if err != nil {
				return err
			}
			if name = strings.TrimSpace(name); name != "" {
				names = append(names, name)
			}
		}
		*n = names
		return nil
	default:
		return fmt.Errorf("a list of names has to be written as an array or as a string, not as %T", raw)
	}
}

// Schema documents the canonical array and the shapes accepted on import.
func (Names) Schema(huma.Registry) *huma.Schema {
	name := &huma.Schema{Type: huma.TypeString}

	schema := &huma.Schema{
		Title:    "Names",
		Nullable: true,
		Description: "Names of the related records. Always written as an array of strings. " +
			"On an import a single string is accepted, a comma-separated one (\"Action, RPG\") " +
			"is split, and an object carrying a name is read as that name. An empty array " +
			"clears the relation, while leaving the field out keeps it.",
		OneOf: []*huma.Schema{
			name,
			{
				Type: huma.TypeArray,
				Items: &huma.Schema{
					OneOf: []*huma.Schema{
						name,
						{Type: huma.TypeObject, AdditionalProperties: true},
					},
				},
			},
		},
		Examples: []any{[]string{"Metroidvania"}},
	}
	schema.PrecomputeMessages()
	return schema
}

// splitNames turns "Action, RPG" into its two names. A name holding a comma
// has to be written as an array element of its own.
func splitNames(value string) Names {
	names := make(Names, 0, 1)
	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			names = append(names, part)
		}
	}
	return names
}

// itemName reads one element of a list of names, which other tools export
// either as a string or as an object with the name inside.
func itemName(item any) (string, error) {
	switch value := item.(type) {
	case string:
		return value, nil
	case map[string]any:
		for _, key := range []string{"name", "title", "nombre"} {
			if name, ok := value[key].(string); ok {
				return name, nil
			}
		}
		return "", fmt.Errorf("an object in a list of names has no name field")
	default:
		return "", fmt.Errorf("a name has to be a string, not a %T", item)
	}
}
