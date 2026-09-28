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

POST   /api/images                          uploads a cover or avatar
GET    /api/images/{name}

GET    /api/export                          the library as one JSON document
POST   /api/import?mode=&dry_run=           loads one back in
GET    /api/backup                          the whole account as a .zip
POST   /api/backup                          restores one
```

`/api/docs` is the authoritative list, with every parameter and schema.

Listing the games of a genre, a developer, a publisher or a platform is a filter on `GET /api/games` rather than a nested route, since the listing already has to support the same joins.

A game is written with its relations as ids (`platform_id`, `genre_ids`, `developer_ids`, `publisher_ids`) and read back with them loaded, so saving a game can never create or rename a genre. `PUT` replaces the whole record: anything left out of the body is cleared.

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
