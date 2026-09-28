# Import and export

`GET /api/export` hands back every game, genre, developer, publisher and platform of your library as a single JSON document, and `POST /api/import` reads one back. The data is yours, and this is what makes that true rather than a slogan.

```json
{
  "version": 1,
  "exported_at": "2026-09-13T08:00:00Z",
  "platforms": [
    { "name": "Nintendo Switch", "icon": "🎮", "color": "#e60012" }
  ],
  "genres": [{ "name": "Metroidvania", "icon": "🗺️" }],
  "developers": [{ "name": "Team Cherry", "icon": null }],
  "publishers": [{ "name": "Team Cherry", "icon": null }],
  "games": [
    {
      "title": "Hollow Knight",
      "status": "played",
      "score": 9.2,
      "tagline": "Lonely bug, big map",
      "notes": null,
      "cover_image_url": null,
      "release_date": "2017-02-24",
      "logged_date": "2026-01-15",
      "platform": "Nintendo Switch",
      "genres": ["Metroidvania"],
      "developers": ["Team Cherry"],
      "publishers": ["Team Cherry"]
    }
  ]
}
```

Relations are written **by name, never by id**. An id belongs to one database, while a name is what you typed, so the file survives being imported into another copy of Gamelog, edited in a text editor, or kept as the backup of a database that no longer exists.

The export is served with a `Content-Disposition` header, so opening `/api/export` in a browser saves a `gamelog-YYYY-MM-DD.json` file instead of painting JSON on the screen.

## What the import accepts

The reader is deliberately forgiving, because the files worth importing were written by something else — a Notion export, a spreadsheet, another tracker.

- **Any subset of the sections.** A file holding only genres imports only genres. The `games` section on its own is a complete import: the platforms, genres, developers and publishers a game names are created as they come up.
- **A bare array of games** as the whole body, which is what a single database exported on its own looks like.
- **Field names matched loosely**, ignoring case, spaces and punctuation, with the common alternatives understood: `name` for `title`, `rating` for `score`, `cover` or `image` for `cover_image_url`, `tags` for `genres`, and the Spanish equivalents (`nombre`, `nota`, `portada`, `plataforma`, `fecha`...). Fields the format knows nothing about are ignored rather than rejected.
- **Statuses read the same way**: `backlog`, `to play`, `in progress`, `finished`, `completed`, `pendiente`, `jugando`, `terminado` and the like all land on one of `wishlist`, `pending`, `playing`, `played`.
- **Dates in several spellings**: `2017-02-24`, `24/02/2017` (day first), `24-02-2017`, `24 February 2017`, `February 24, 2017` or a full RFC 3339 instant.
- **Numbers as numbers or as strings**, where a comma is the decimal separator, so `"9,2"` is 9.2.
- **Lists in any shape**: `["Action", "RPG"]`, `"Action, RPG"` or `[{"name": "Action"}]`.

## What it does with them

Records are matched by name — by title, for a game — ignoring case and accents, which is how the database compares them. Importing the same file twice updates the same records instead of duplicating them.

| Query | Default | What it does |
| --- | --- | --- |
| `mode=merge` | yes | Writes the document over the library and leaves the rest alone |
| `mode=replace` |  | Empties the library first, which is how a backup is restored |
| `dry_run=true` |  | Runs the import, rolls it back and answers with the report it would have produced |

Within a game, a field the document leaves out keeps whatever the library holds, and a field sent empty (`""`, or `[]` for a relation) clears it. So a spreadsheet of nothing but titles and new scores is an update of two columns, not a wipe of everything else.

The whole import is one transaction: a document either lands completely or not at all. Entries it cannot read do not fail it, though — they are skipped, and the answer says exactly which and why, along with everything the importer had to interpret:

```json
{
  "mode": "merge",
  "dry_run": false,
  "created": {
    "platforms": 1,
    "genres": 3,
    "developers": 1,
    "publishers": 0,
    "games": 2
  },
  "updated": {
    "platforms": 0,
    "genres": 0,
    "developers": 0,
    "publishers": 0,
    "games": 0
  },
  "deleted": {
    "platforms": 0,
    "genres": 0,
    "developers": 0,
    "publishers": 0,
    "games": 0
  },
  "skipped": [
    {
      "section": "games",
      "index": 4,
      "entry": "",
      "message": "an entry with no title cannot be imported"
    }
  ],
  "warnings": [
    {
      "section": "games",
      "index": 1,
      "entry": "Celeste",
      "message": "\"no idea\" is not a status this import knows, so the game was filed as \"pending\" instead"
    }
  ]
}
```

A round trip from the command line, logging in first for a session cookie:

```sh
curl -s -c cookies.txt https://gamelog.example.com/api/auth/login \
     -H 'Content-Type: application/json' -d '{"username": "me", "password": "..."}'
curl -s -b cookies.txt https://gamelog.example.com/api/export > gamelog.json
curl -s -b cookies.txt -X POST "https://gamelog.example.com/api/import?mode=replace&dry_run=true" \
     -H 'Content-Type: application/json' --data-binary @gamelog.json
```

## Full backups

The JSON document is the library alone. `GET /api/backup` — the download on the **Account** page — wraps that same document, your profile and every cover and avatar image it names into a `.zip`, and `POST /api/backup` restores one, replacing your library the way `mode=replace` does. It is meant for moving to a new deployment or recovering from a lost one, not for combining two libraries.
