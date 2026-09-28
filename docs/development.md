# Development

## Requirements

- Go ≥ 1.26
- Node ≥ 22
- Docker with the Compose plugin (for the database and the tests)
- `air`: `go install github.com/air-verse/air@latest` (drops the binary in `$(go env GOPATH)/bin`, which must be on your `PATH`)

Alternatively, with [Nix](https://nixos.org/download) installed, everything above except Docker in one go:

```sh
nix develop
```

## Running locally

Backend and frontend run natively; only MariaDB runs in Docker. One process per terminal, each with its own clean logs.

```sh
cp .env.example .env
```

**Terminal 1 — database**

```sh
docker compose up -d
```

Brings up MariaDB on `127.0.0.1:3306` and Adminer on <http://localhost:8081> (`compose.override.yaml` is applied automatically, no flags needed).

**Terminal 2 — backend**

```sh
cd backend
air
```

API on <http://localhost:8080>. Rebuilds and restarts whenever a `.go` file is saved. Without `air` installed: `go run ./cmd/server`.

**Terminal 3 — frontend**

```sh
cd frontend
npm install   # first time only
npm run dev
```

Frontend on <http://localhost:5173> with HMR.

Quick check that all three are talking to each other:

```sh
curl http://localhost:5173/api/health
# {"status":"ok","service":"gamelog","database":"ok","time":"..."}
```

The first time you open <http://localhost:5173> the database has no accounts, so the application asks you to choose a password for `admin`. See [Accounts](self-hosting.md#accounts).

### Testing from a phone

Views are designed mobile-first, so it is worth opening them on a real phone early. The Vite dev server only listens on `localhost`; to expose it to the local network (or your tailnet):

```sh
cd frontend
npm run dev -- --host
```

Vite will print the network URL. API calls are proxied by the Vite server itself, so there is no need to expose the backend as well.

## How it fits together

The backend serves `/api/*` and nothing else — never a static file. The frontend always calls relative `/api/...` paths: in development the Vite dev server proxies them to the backend on `:8080` (see [`frontend/vite.config.ts`](../frontend/vite.config.ts)), and in the published image Caddy serves the frontend's static build and proxies `/api/*` to the backend on the same origin. That removes the need for CORS in the backend and for per-environment URLs.

## Database

The schema lives in [`backend/migrations`](../backend/migrations) as goose migrations, embedded into the binary. They are the single source of truth: GORM's `AutoMigrate` is disabled, so the structs in `internal/models` never change the schema on their own.

Pending migrations are applied automatically at startup (unless `GAMELOG_MIGRATE=false`). To change the schema, add a file to `backend/migrations` named `<version>_<description>.sql` with both directions:

```sql
-- +goose Up
ALTER TABLE games ADD COLUMN notes TEXT NULL;

-- +goose Down
ALTER TABLE games DROP COLUMN notes;
```

Adminer (<http://localhost:8081>) is the quickest way to inspect the data by hand.

## Tests

```sh
cd backend && go test ./...
```

Tests do not depend on the development environment: each one starts its own throwaway MariaDB container with testcontainers and migrates it, so nothing has to be running beforehand — but Docker must be available. A full run takes about a minute.

To skip everything that needs Docker:

```sh
cd backend && go test -short ./...
```

The frontend is checked with its linter and the TypeScript build:

```sh
cd frontend && npm run lint && npm run build
```

## Documentation

`README.md` and everything under `docs/` follow one Markdown style, enforced with [Prettier](https://prettier.io): each paragraph is a single line, left for the editor or GitHub to wrap, so an edit never reflows the lines around it. After editing any of them, run:

```sh
scripts/format-docs.sh          # rewrites the files in place
scripts/format-docs.sh --check  # only reports, as CI does
```

It needs nothing but Node: the script runs a pinned Prettier version through `npx`, with the rules in [`.prettierrc.json`](../.prettierrc.json). Editors that format with Prettier, such as Zed or VS Code with its extension, pick up the same file.

## Building the image

```sh
docker buildx build -t gamelog .
```

The Dockerfile needs BuildKit (`docker buildx`): the build stages run on the builder's own platform and cross-compile for the target one, which the legacy builder does not support.

## Commits and pull requests

Changes reach `main` through pull requests, which are squash-merged: each one lands as a single commit whose message is the pull request's title.

Those titles, and commits in general, follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat(games): redesign filters as Notion-style pills
fix(calendar): keep the last week inside the month
docs: describe the commit conventions
```

The scope is optional, and names an area of the app rather than a layer, since most changes touch both backend and frontend: `games`, `calendar`, `lookups`, `auth`, `import`, `api`.

A breaking change (`feat!:`, or a `BREAKING CHANGE:` footer) is one that makes somebody self-hosting Gamelog act on their deployment or their data: renaming or removing a `GAMELOG_*` variable, changing the port or the `/data` volume, an import/export format older files no longer load into, a removed or incompatible API endpoint, a higher minimum MariaDB version. A new migration is not one, since it is applied on its own at startup.

## CI and releases

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `gofmt`, `go vet`, the backend tests, the frontend linter, the frontend build and the documentation check on every pull request and every push to `main`. A branch without a pull request gets no CI run, so open a draft pull request to get one while work is still in progress.

Once those pass, a push to `main` publishes the `edge` image, and pushing a tag `vX.Y.Z` publishes that release as `X.Y.Z`, `X.Y`, `X` and `latest` and creates its GitHub Release, with notes generated from the commits since the previous one. Versions follow [Semantic Versioning](https://semver.org).

```sh
git tag v1.2.0
git push origin v1.2.0
```

## Layout

```
backend/
  cmd/server/        entry point
  internal/
    auth/            passwords, session tokens, the auth middleware
    config/          configuration from the environment
    database/        connection pool + migration runner
    models/          entities and the Status enum
    repository/      data access (GORM)
    service/         business logic, import/export and backups
    handlers/        HTTP controllers
    router/          routes and the API documentation page
    slug/            URL slugs for games and lookups
    testsupport/     throwaway databases for tests
  migrations/        goose SQL migrations, embedded
frontend/src/
  api/               typed HTTP client
  components/        reusable components
  pages/             one per view
  hooks/             data hooks (TanStack Query)
  lib/               formatting and other helpers
  theme/             light/dark choice
  types/             types shared with the API
docs/                this documentation
```

## Conventions

- **English only**: code, comments, commit messages, documentation and UI copy.
- **Mobile-first**: every view is designed for a small screen first and scaled up with Tailwind breakpoints.
- **Go**: standard library plus chi, no global state — configuration is passed explicitly. `gofmt`, `go vet` and `go test ./...` stay clean.
- **Frontend**: server state goes through TanStack Query, styling through Tailwind utilities.
