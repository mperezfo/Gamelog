# API

The frontend is a client of a REST API under `/api`, and nothing it does is out of reach of any other client.

The API describes itself. Every operation is registered with [Huma](https://huma.rocks), which derives an OpenAPI 3.1 document from the same Go types that validate the requests and serialise the responses — so there are no annotations to keep in sync, no generated file in the repository and no codegen step in the build.

| Path | What it is |
| --- | --- |
| `/api/docs` | Interactive documentation: reads the operations and issues real requests against the API |
| `/api/openapi.json`, `/api/openapi.yaml` | The OpenAPI document, for client generators, linters and editors |
| `/api/schemas/{schema}.json` | One JSON Schema per type, which responses link to through their `$schema` field |

The document carries no `servers` list on purpose: a client resolves the paths against the origin it read the document from, which is what makes one document correct in development, in a test deployment and in production without a per-environment base URL.

## The documentation page

The page is served by the backend rather than by Huma, but it is the page Huma would have rendered: the same [Stoplight Elements](https://stoplight.io/open-source/elements) component, at the same pinned version, behind the same integrity hashes and the same content security policy. The only difference is a one-rule stylesheet that hides the mark the renderer leaves in its footer, since the page belongs to this deployment.

It is a desktop page. Elements is awkward on a phone, and ships no dark theme. From a phone, read `/api/openapi.yaml`, which is legible anywhere.

Its assets are loaded from unpkg by the browser showing the page, not by the server, so a deployment with no outbound internet access serves it fine — but a browser that cannot reach unpkg (an air-gapped client, a blocked CDN) will render it blank. The document at `/api/openapi.yaml` stays readable either way.

The console writes to the real database of whatever it is served from, with whatever session the browser showing it holds: log in through the application first and its requests go out as you, exactly like the frontend's. Set `GAMELOG_DOCS=false` to take the page away anyway; the OpenAPI document stays served either way, since it describes the API without granting access to it.

## Endpoints

```
GET    /api/health

POST   /api/auth/login                      opens a session and sets the cookie
POST   /api/auth/logout
GET    /api/auth/me                         the current account, or 401
PUT    /api/auth/password                   change your own
PUT    /api/auth/profile                    display name and avatar
PUT    /api/auth/preferences                theme and view settings

GET    /api/setup                           is the first run still pending?
POST   /api/setup                           creates the admin, once

GET    /api/users                           admin only
POST   /api/users                           admin only
DELETE /api/users/{id}                      admin only
PUT    /api/users/{id}/password             admin only

GET    /api/games?status=&platform_id=&genre_id=&developer_id=&publisher_id=&sort=&order=
GET    /api/games/stats      same filters, returns count, average score and date range
POST   /api/games
GET    /api/games/{id}
PUT    /api/games/{id}
DELETE /api/games/{id}

GET/POST            /api/genres        (same for developers, publishers, platforms)
GET/PUT/DELETE      /api/genres/{id}
DELETE              /api/developers/{id}/igdb/{igdb_id}   (same for publishers, platforms)

POST   /api/images                          uploads a cover or avatar
POST   /api/images/import                   copies an image from the image search
GET    /api/images/{name}?size=             sm or md for a thumbnail, made once

GET    /api/export                          the library as one JSON document
POST   /api/import?mode=&dry_run=           loads one back in
GET    /api/backup                          the whole account as a .zip
POST   /api/backup                          restores one

GET    /api/metadata/capabilities           which metadata lookups this deployment offers
GET    /api/metadata/games?title=           looks a game up on IGDB
GET    /api/metadata/companies?ids=         names IGDB companies by id
GET    /api/metadata/companies/{id}/page    redirects to a company's page on IGDB
GET    /api/metadata/platforms?ids=         names IGDB platforms by id
GET    /api/metadata/platforms/{id}/page    redirects to a platform's page on IGDB
GET    /api/metadata/release-dates?ids=     reads the release dates IGDB has now for games
GET    /api/metadata/games/{id}/page        redirects to a game's page on IGDB
GET    /api/metadata/images?source=&title=&game_id=   a game's images on IGDB or SteamGridDB
```

`/api/docs` is the authoritative list, with every parameter and schema.

Listing the games of a genre, a developer, a publisher or a platform is a filter on `GET /api/games` rather than a nested route, since the listing already has to support the same joins.

Genres and platforms carry an `icon` (an emoji), platforms a `color` too, and developers and publishers a `country` instead of an icon: an ISO 3166-1 two-letter code (`"JP"`), shown as its flag.

A game is written with its relations as ids (`platform_id`, `genre_ids`, `developer_ids`, `publisher_ids`) and read back with them loaded, so saving a game can never create or rename a genre by accident. `PUT` replaces the whole record: anything left out of the body is cleared.

The one way a game write creates records is on request: `new_developers` and `new_publishers` name developers and publishers to attach, created if the library does not have them yet, and `developer_links` and `publisher_links` tie existing ones to the IGDB company each stands for. `new_platform` and `platform_link` do the same for the game's platform. Developers and publishers are read back with the `igdb_company_ids` they are linked to, and platforms with their `igdb_platform_ids`. Both come with `igdb_names`, the names IGDB gives the linked records that the server has a copy of: it keeps the ones a search or `GET /api/metadata/companies` (and `/platforms`) hands over, the latter bringing them up to date, and names the rest at startup when IGDB is configured. A link with no copy yet is left out of `igdb_names`. A company link, or a new developer or publisher, can carry the `country` IGDB gives the company (as `GET /api/metadata/games` hands it over), which the record takes when it has none: a country set by hand is never overwritten. An IGDB company stands for one developer (or publisher) at most, so linking it again moves it; an IGDB platform can stand for several platforms (a library's "PC" and "Steam Deck" are both IGDB's PC), so a new link adds to the ones it has. `DELETE /api/developers/{id}/igdb/{igdb_id}` (and its publisher and platform equivalents) forgets one link. A game carries the `igdb_id` of the IGDB game it was identified as; like every other field of a write, leaving it out unlinks the game. All of it is written in the same transaction as the game, so a write that fails, or a form that is abandoned, leaves nothing behind.

`GET /api/metadata/games` searches IGDB by title and answers with the candidate games, their release date, platforms, developers and publishers. Each platform, developer and publisher comes with the record of your library it most likely is: the one already linked to it on IGDB (for a platform linked to several, the one with the most games), or a guess from the name, which the game form shows as a suggestion to confirm. A platform is guessed from IGDB's abbreviation ("PS5") before its full name. It needs IGDB credentials (see [Self-hosting](self-hosting.md#game-metadata-igdb)): without them it answers `501`, and `GET /api/metadata/capabilities` reports `identify: false`. When IGDB itself fails, the answer is `424`.

`GET /api/metadata/images` looks a game up on IGDB or SteamGridDB (`source`) and answers with its images, grouped by kind (heroes before grids on SteamGridDB, the cover before the artworks on IGDB), along with the other games the title may refer to. `game_id` asks for one game's images by the source's own id, such as a game's `igdb_id`; without it, the first match for the title is used. `GET /api/metadata/capabilities` lists the sources configured as `image_sources`, and a source that is not answers `501`. The images stay on the source: `POST /api/images/import` takes the `url` of one, downloads it (only from IGDB's and SteamGridDB's image hosts) and stores it as an upload would, reduced when it is over the 8 MiB an upload is capped at, answering with the URL to use as a game's `cover_image_url`.

An uploaded image is stored as what its bytes say it is, whatever the file was called. `POST /api/images` accepts PNG, JPEG, WebP, GIF and AVIF, and converts AVIF to JPEG (or PNG, when it has transparency), so the URL it answers with can end in a different extension from the file sent.

See [Import and export](import-export.md) for the export document and what the import accepts.

## Access

Everything but `/api/health`, `/api/setup` and logging in needs a session, and everything but the account management needs a regular one: the admin is refused from the games, the lookups and the import and export. Every record belongs to one account, and another account's records behave as if they did not exist.

Failures come back as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details: `401` without a session, `403` when the account is the wrong kind, `404` for a missing record — including one belonging to somebody else — `409` for a name already taken and for deleting a record some game still uses, and `422` for a body or a parameter the schema rejects and for ids pointing at rows that do not exist.

## Adding an operation

Write the input and output types, then register the operation — the documentation follows from that, with nothing else to update:

```go
type listGamesInput struct {
	Status models.Status `query:"status" doc:"Keep only games in this status."`
}

huma.Register(api, huma.Operation{
	OperationID: "list-games",
	Method:      http.MethodGet,
	Path:        "/api/games",
	Summary:     "List games",
	Tags:        []string{"Games"},
}, func(ctx context.Context, input *listGamesInput) (*gameListOutput, error) {
	...
})
```

Validation tags (`minimum`, `maxLength`, `enum`, `format`, ...) are enforced before the handler runs and are what the documentation shows. Where a rule already exists in Go, it is reused instead of repeated: the `status` enum is built from `models.Statuses()`, and a test checks that the `sort` values match `repository.SortFields()`.

An operation that says nothing about authentication gets a regular account's session. The default is fail-closed on purpose: a route added without a thought about who may call it ends up protected rather than open. Say otherwise with `Metadata: auth.Require(auth.AccessPublic)` — or `AccessAdmin`, or `AccessAny` for something about the session itself — and read the account the request was authenticated as with `currentUser(ctx)`.
