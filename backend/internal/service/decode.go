package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"
	"unicode"

	"github.com/danielgtaylor/huma/v2"

	"github.com/mperezfo/gamelog/internal/models"
)

// The types below are the reading half of the format. They exist next to the
// writing half rather than reusing it because they answer a different
// question: not "what does a library look like", but "what did this file
// probably mean". Three things follow from that.
//
// Every field is optional and carries its own presence: a field the document
// left out is left as it is in the library, which is what makes an import of
// three games with a new score a three-field update rather than a wipe.
//
// Field names are matched loosely, through the alias tables at the bottom, so
// that a file exported from Notion or converted from a spreadsheet does not
// have to be renamed column by column first.
//
// Unknown fields are ignored instead of rejected. A real export carries a
// dozen columns Gamelog knows nothing about, and refusing the whole file over
// them would make the import useless for exactly the files it exists to read.

// ImportDocument is the body of an import: a whole library, or just the list
// of games, which is what a single database exported on its own looks like.
type ImportDocument struct {
	ImportLibrary
}

// UnmarshalJSON reads either accepted top-level shape.
func (d *ImportDocument) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) > 0 && trimmed[0] == '[' {
		return json.Unmarshal(trimmed, &d.Games)
	}
	return json.Unmarshal(trimmed, &d.ImportLibrary)
}

// Schema documents both shapes as one union.
func (ImportDocument) Schema(r huma.Registry) *huma.Schema {
	schema := &huma.Schema{
		Title: "ImportDocument",
		Description: "A library to import. Either an object with a section per entity — the " +
			"shape an export writes — or, as a shortcut, an array holding nothing but games.",
		OneOf: []*huma.Schema{
			r.Schema(reflect.TypeFor[ImportLibrary](), true, "ImportLibrary"),
			{
				Type:  huma.TypeArray,
				Items: r.Schema(reflect.TypeFor[ImportGame](), true, "ImportGame"),
			},
		},
	}
	schema.PrecomputeMessages()
	return schema
}

// ImportLibrary is the object form of an import document. Every section is
// optional: a file carrying only genres imports only genres.
type ImportLibrary struct {
	_ struct{} `additionalProperties:"true"`

	Platforms  []ImportLookup `json:"platforms,omitempty" doc:"Platforms to import."`
	Genres     []ImportLookup `json:"genres,omitempty" doc:"Genres to import."`
	Developers []ImportLookup `json:"developers,omitempty" doc:"Developers to import."`
	Publishers []ImportLookup `json:"publishers,omitempty" doc:"Publishers to import."`
	Games      []ImportGame   `json:"games,omitempty" doc:"Games to import. The genres, developers, publishers and platforms they name are created if the library does not have them yet, so this section alone is enough."`
}

// UnmarshalJSON reads the sections under any of their accepted names.
func (l *ImportLibrary) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("an import document has to be an object with a section per entity, or an array of games: %w", err)
	}

	rekeyed, err := json.Marshal(rekey(raw, librarySections))
	if err != nil {
		return err
	}

	// The alias without the method, so that unmarshalling the rekeyed object
	// does not come back through here.
	type plain ImportLibrary
	return json.Unmarshal(rekeyed, (*plain)(l))
}

// ImportLookup is one genre, developer, publisher or platform of an import.
// It is written either as an object or, when there is no icon to carry, as
// the bare name.
type ImportLookup struct {
	ImportName
}

// ImportName is the object form of a simple entity in an import.
type ImportName struct {
	_ struct{} `additionalProperties:"true"`

	Name  *string `json:"name,omitempty" nullable:"true" doc:"Name of the record. An existing record is found by this name, ignoring case and accents." example:"Metroidvania"`
	Icon  *string `json:"icon,omitempty" nullable:"true" doc:"Emoji or short icon. Left out, an existing icon is kept; sent empty, it is cleared." example:"🗺️"`
	Color *string `json:"color,omitempty" nullable:"true" doc:"Hex colour (\"#3b82f6\"). Only applied to a platform; ignored for the other three, the same way an icon they cannot have would be. Left out, an existing colour is kept; sent empty, it is cleared." example:"#3b82f6"`
}

// UnmarshalJSON reads the bare name as well as the object.
func (l *ImportLookup) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)

	if len(trimmed) > 0 && trimmed[0] == '"' {
		var name string
		if err := json.Unmarshal(trimmed, &name); err != nil {
			return err
		}
		l.Name = &name
		return nil
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(trimmed, &raw); err != nil {
		return fmt.Errorf("a genre, developer, publisher or platform has to be a name or an object: %w", err)
	}

	rekeyed, err := json.Marshal(rekey(raw, lookupFields))
	if err != nil {
		return err
	}
	return json.Unmarshal(rekeyed, &l.ImportName)
}

// Schema documents both shapes as one union.
func (ImportLookup) Schema(r huma.Registry) *huma.Schema {
	schema := &huma.Schema{
		Title:       "ImportLookup",
		Description: "A genre, developer, publisher or platform: an object, or just its name.",
		OneOf: []*huma.Schema{
			{Type: huma.TypeString},
			r.Schema(reflect.TypeFor[ImportName](), true, "ImportName"),
		},
	}
	schema.PrecomputeMessages()
	return schema
}

// ImportGame is one game of an import.
//
// Every field is a pointer or a slice so that three states can be told apart:
// left out (or null) keeps whatever the library holds, empty clears the field,
// and anything else sets it.
type ImportGame struct {
	_ struct{} `additionalProperties:"true"`

	Title  *string `json:"title,omitempty" nullable:"true" doc:"Title of the game. An entry without one is skipped, since there is nothing to match it on." example:"Hollow Knight"`
	Status *string `json:"status,omitempty" nullable:"true" doc:"Lifecycle stage. Read loosely: backlog, to play, in progress, finished, completed and their Spanish equivalents all land on one of wishlist, pending, playing or played. A new game with no status is imported as pending." example:"played"`

	Score         *Number `json:"score,omitempty" doc:"Personal score from 0 to 10, rounded to one decimal."`
	Tagline       *string `json:"tagline,omitempty" nullable:"true" doc:"Very short personal description." example:"Lonely bug, big map"`
	Notes         *string `json:"notes,omitempty" nullable:"true" doc:"Free-form notes."`
	CoverImageURL *string `json:"cover_image_url,omitempty" nullable:"true" doc:"URL of the cover image."`
	CoverFocalX   *Number `json:"cover_focal_x,omitempty" doc:"Horizontal focal point of the cover, from 0 to 1, used to crop it in portrait. Left out or null centres it."`
	CoverFocalY   *Number `json:"cover_focal_y,omitempty" doc:"Vertical focal point of the cover, from 0 to 1, used to crop it in portrait. Left out or null centres it."`
	CoverZoom     *Number `json:"cover_zoom,omitempty" doc:"Zoom applied to the cover in portrait, from 1 to 3. Left out or null is no zoom."`

	ReleaseDate *Date `json:"release_date,omitempty" doc:"Release date of the game."`
	LoggedDate  *Date `json:"logged_date,omitempty" doc:"When the game was started, logged or finished."`

	Platform   *string `json:"platform,omitempty" nullable:"true" doc:"Name of the platform. Created if the library does not have it yet." example:"Nintendo Switch"`
	Genres     Names   `json:"genres,omitempty" doc:"Names of the genres. Any that the library does not have yet are created."`
	Developers Names   `json:"developers,omitempty" doc:"Names of the developers. Any that the library does not have yet are created."`
	Publishers Names   `json:"publishers,omitempty" doc:"Names of the publishers. Any that the library does not have yet are created."`
}

// UnmarshalJSON reads the fields under any of their accepted names.
func (g *ImportGame) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("a game has to be a JSON object: %w", err)
	}

	rekeyed, err := json.Marshal(rekey(raw, gameFields))
	if err != nil {
		return err
	}

	type plain ImportGame
	return json.Unmarshal(rekeyed, (*plain)(g))
}

// librarySections are the accepted names of the top-level sections.
var librarySections = map[string]string{
	"platforms": "platforms", "platform": "platforms", "consoles": "platforms",
	"plataformas": "platforms",

	"genres": "genres", "genre": "genres", "tags": "genres",
	"generos": "genres", "etiquetas": "genres",

	"developers": "developers", "developer": "developers", "studios": "developers",
	"desarrolladores": "developers", "estudios": "developers",

	"publishers": "publishers", "publisher": "publishers",
	"editores": "publishers", "distribuidoras": "publishers",

	"games": "games", "game": "games", "library": "games", "entries": "games",
	"juegos": "games", "biblioteca": "games",
}

// lookupFields are the accepted names of the fields of a simple entity.
var lookupFields = map[string]string{
	"name": "name", "title": "name", "label": "name",
	"nombre": "name", "titulo": "name",

	"icon": "icon", "emoji": "icon", "symbol": "icon",
	"icono": "icon",

	"color": "color", "colour": "color", "hex": "color",
	"colorcode": "color", "colourcode": "color", "hexcolor": "color",
	"codigodecolor": "color",
}

// gameFields are the accepted names of the fields of a game. The keys are
// normalised by normalizeKey, so "Cover image URL" and "cover_image_url" are
// the same entry.
var gameFields = map[string]string{
	"title": "title", "name": "title", "game": "title",
	"nombre": "title", "juego": "title",

	"status": "status", "state": "status", "progress": "status",
	"estado": "status",

	"score": "score", "rating": "score", "puntuation": "score",
	"nota": "score", "puntuacion": "score", "valoracion": "score",

	"tagline": "tagline", "fourwords": "tagline", "shortdescription": "tagline",
	"cuatropalabras": "tagline", "descripcioncorta": "tagline",

	"notes": "notes", "note": "notes", "summary": "notes", "review": "notes",
	"comments": "notes", "description": "notes",
	"notas": "notes", "resumen": "notes", "resena": "notes", "comentarios": "notes",

	"coverimageurl": "cover_image_url", "cover": "cover_image_url",
	"coverurl": "cover_image_url", "coverart": "cover_image_url",
	"image": "cover_image_url", "imageurl": "cover_image_url",
	"thumbnail": "cover_image_url", "boxart": "cover_image_url",
	"portada": "cover_image_url", "caratula": "cover_image_url", "imagen": "cover_image_url",

	"coverfocalx": "cover_focal_x", "coverfocaly": "cover_focal_y", "coverzoom": "cover_zoom",

	"releasedate": "release_date", "release": "release_date",
	"released": "release_date", "launchdate": "release_date",
	"lanzamiento": "release_date", "fechadelanzamiento": "release_date", "estreno": "release_date",

	"loggeddate": "logged_date", "date": "logged_date", "played": "logged_date",
	"playedon": "logged_date", "datefinished": "logged_date", "finishdate": "logged_date",
	"fecha": "logged_date", "fechajugado": "logged_date",

	"platform": "platform", "console": "platform", "system": "platform",
	"plataforma": "platform", "consola": "platform", "sistema": "platform",

	"genres": "genres", "genre": "genres", "tags": "genres", "categories": "genres",
	"category": "genres", "generos": "genres", "genero": "genres", "categorias": "genres",

	"developers": "developers", "developer": "developers", "studio": "developers",
	"studios": "developers", "dev": "developers",
	"desarrollador": "developers", "desarrolladores": "developers", "estudio": "developers",

	"publishers": "publishers", "publisher": "publishers", "editor": "publishers",
	"editores": "publishers", "distribuidora": "publishers", "distribuidoras": "publishers",
}

// statusAliases maps what other trackers call a status onto the four of
// models.Status. The keys are normalised by normalizeKey.
var statusAliases = map[string]models.Status{
	"wishlist": models.StatusWishlist, "wish": models.StatusWishlist,
	"wanted": models.StatusWishlist, "want": models.StatusWishlist,
	"wanttoplay": models.StatusWishlist, "deseado": models.StatusWishlist,
	"deseados": models.StatusWishlist, "listadedeseos": models.StatusWishlist,

	"pending": models.StatusPending, "backlog": models.StatusPending,
	"todo": models.StatusPending, "toplay": models.StatusPending,
	"notstarted": models.StatusPending, "next": models.StatusPending,
	"unplayed": models.StatusPending, "pendiente": models.StatusPending,
	"pendientes": models.StatusPending, "porjugar": models.StatusPending,

	"playing": models.StatusPlaying, "inprogress": models.StatusPlaying,
	"started": models.StatusPlaying, "current": models.StatusPlaying,
	"currentlyplaying": models.StatusPlaying, "ongoing": models.StatusPlaying,
	"jugando": models.StatusPlaying, "encurso": models.StatusPlaying,
	"enprogreso": models.StatusPlaying,

	"played": models.StatusPlayed, "done": models.StatusPlayed,
	"finished": models.StatusPlayed, "complete": models.StatusPlayed,
	"completed": models.StatusPlayed, "beaten": models.StatusPlayed,
	"jugado": models.StatusPlayed, "jugados": models.StatusPlayed,
	"terminado": models.StatusPlayed, "completado": models.StatusPlayed,
	"acabado": models.StatusPlayed, "finalizado": models.StatusPlayed,
}

// parseStatus reads a status under any of its accepted names.
func parseStatus(raw string) (models.Status, bool) {
	status, ok := statusAliases[normalizeKey(raw)]
	return status, ok
}

// rekey maps the fields of a JSON object onto the canonical names of the
// format, dropping the ones the format knows nothing about.
//
// The canonical spelling of a field wins over any alias of it, and the rest
// are read in a stable order, so that a document carrying two names for the
// same field imports the same way every time.
func rekey(raw map[string]json.RawMessage, aliases map[string]string) map[string]json.RawMessage {
	keys := slices.Sorted(maps.Keys(raw))
	out := make(map[string]json.RawMessage, len(raw))

	for _, key := range keys {
		if target, ok := aliases[normalizeKey(key)]; ok && target == key {
			out[key] = raw[key]
		}
	}
	for _, key := range keys {
		target, ok := aliases[normalizeKey(key)]
		if !ok {
			continue
		}
		if _, taken := out[target]; !taken {
			out[target] = raw[key]
		}
	}

	return out
}

// accents folds the letters a Spanish document is likely to carry, so that
// "Puntuación" and "puntuacion" are the same key.
var accents = strings.NewReplacer(
	"á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u",
	"à", "a", "è", "e", "ì", "i", "ò", "o", "ù", "u",
	"ä", "a", "ë", "e", "ï", "i", "ö", "o", "ü", "u",
	"ñ", "n", "ç", "c",
)

// normalizeKey reduces a name to its letters and digits in lower case, so that
// "Cover image URL", "cover_image_url" and "coverImageURL" all match.
func normalizeKey(key string) string {
	var folded strings.Builder
	folded.Grow(len(key))

	for _, r := range accents.Replace(strings.ToLower(strings.TrimSpace(key))) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			folded.WriteRune(r)
		}
	}

	return folded.String()
}
