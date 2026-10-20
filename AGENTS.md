# Agent instructions

Rules for working on Gamelog. The workflow itself is in [`docs/development.md`](docs/development.md) and the API in [`docs/api.md`](docs/api.md).

## English only

Everything in the repository is written in English: code, comments, log and error messages, UI copy, documentation, configuration comments, commit messages, branch names and pull requests. This holds even when you are asked for a change in another language.

## Structure

Monorepo with two independently deployable units:

- `backend/`: Go REST API, serving `/api/*` only. It never serves static files.
- `frontend/`: React + TypeScript + Vite, built as a static bundle.

The frontend always calls relative `/api/...` paths: the Vite dev server proxies them in development, and in production both are served from the same origin. Do not add CORS middleware or per-environment base URLs.

## Conventions

- **Mobile-first.** Every view is designed for a small screen first and scaled up with Tailwind breakpoints, not patched for mobile afterwards.
- **Go**: standard library plus chi. No global state: configuration is passed explicitly. Keep `gofmt`, `go vet` and `go test ./...` clean, and run them inside `nix develop`, since a system Go of another version disagrees with the pinned one.
- Never commit a `go.mod` `go` directive higher than the Go version pinned in `flake.nix`, or the dev shell silently downloads a different toolchain.
- **Frontend**: server state goes through TanStack Query, not `useEffect` + `fetch`. Styling through Tailwind utilities.
- **Prose** (comments, docs, commits): no em dashes. Use commas, colons or parentheses instead.

## Branches and pull requests

- One branch per change, merged into `main` through a squash-merged pull request. Never commit to `main` directly.
- Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org) (`feat(stats): ...`, `fix: ...`): the title is the commit that lands on `main`, and `cliff.toml` builds the release notes from it. Scopes and what counts as breaking are described in `docs/development.md`.
