# Self-hosting

[`Dockerfile`](../Dockerfile) builds a single image with everything the app needs except a database: Caddy serves the frontend's static build and reverse-proxies `/api/*` to the Go backend, both started by [`entrypoint.sh`](../entrypoint.sh), listening on port 9999.

## Image

Images are published to `ghcr.io/mperezfo/gamelog` for `linux/amd64` and `linux/arm64`:

| Tag | What it is |
| --- | --- |
| `latest` | The most recent release |
| `1.2.3`, `1.2`, `1` | A release, or the most recent one in that minor or major line |
| `edge` | The current state of `main`, unreleased |

Pin to a major version (`1`) to get fixes and features without breaking changes, or to an exact one if you want to upgrade by hand.

## Docker Compose

```yaml
services:
  gamelog:
    image: ghcr.io/mperezfo/gamelog:latest
    restart: unless-stopped
    init: true
    environment:
      GAMELOG_DB_HOST: db
      GAMELOG_DB_PASSWORD: change-me
      GAMELOG_SECURE_COOKIE: "true" # if served over HTTPS
    ports:
      - "9999:9999"
    volumes:
      - gamelog-data:/data
    depends_on:
      db:
        condition: service_healthy

  db:
    image: mariadb:11.4
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: gamelog
      MARIADB_USER: gamelog
      MARIADB_PASSWORD: change-me
      MARIADB_RANDOM_ROOT_PASSWORD: "true"
    volumes:
      - db-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

volumes:
  gamelog-data:
  db-data:
```

`db`'s healthcheck matters here, not just for monitoring: without `condition: service_healthy`, `depends_on` only waits for the container to start, not for MariaDB to be ready to accept connections — which takes a few seconds — so `gamelog` would still race it and crash on its first try.

`gamelog-data` is where uploaded covers and avatars are kept (see `GAMELOG_IMAGES_DIR` below) — back it up like the database.

Updating a deployment is:

```sh
docker compose pull && docker compose up -d
```

Pending database migrations are applied at startup, so there is no extra step.

## Behind a reverse proxy

Sitting behind a reverse proxy (Traefik, nginx-proxy-manager, ...) on its own Docker network is the common case: drop the `ports:` mapping, put `gamelog` on that network instead, and point the proxy at port 9999.

### Traefik

With a `proxy` network Traefik already watches:

```yaml
services:
  gamelog:
    image: ghcr.io/mperezfo/gamelog:latest
    restart: unless-stopped
    init: true
    environment:
      GAMELOG_DB_HOST: db
      GAMELOG_DB_PASSWORD: change-me
      GAMELOG_SECURE_COOKIE: "true"
    networks:
      - proxy
      - backend
    volumes:
      - gamelog-data:/data
    depends_on:
      db:
        condition: service_healthy
    labels:
      traefik.enable: "true"
      traefik.docker.network: proxy
      traefik.http.routers.gamelog.rule: Host(`gamelog.example.com`)
      traefik.http.routers.gamelog.entrypoints: websecure
      traefik.http.routers.gamelog.tls.certresolver: letsencrypt
      traefik.http.services.gamelog.loadbalancer.server.port: "9999"

  db:
    image: mariadb:11.4
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: gamelog
      MARIADB_USER: gamelog
      MARIADB_PASSWORD: change-me
      MARIADB_RANDOM_ROOT_PASSWORD: "true"
    networks:
      - backend
    volumes:
      - db-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

networks:
  proxy:
    external: true
  # Not published anywhere: only gamelog and db need to reach each other.
  backend:

volumes:
  gamelog-data:
  db-data:
```

`gamelog` needs both networks — `proxy` is how the reverse proxy in front of it reaches it, `backend` is how it reaches `db` — a service that lists `networks:` stops joining Compose's implicit default network, so without `backend` here `db` would be unreachable by name, which is exactly the bug that produces `lookup db: no such host` in the logs.

Swap `gamelog.example.com` for the real hostname, and `letsencrypt` for whatever certresolver your Traefik instance defines — both are placeholders for values only your setup knows.

### Caddy

For a Caddy instance you run yourself with a static Caddyfile, `gamelog` needs no labels, only to sit on the same `proxy` network as that Caddy container — the same Compose file as above without the `labels:` block, for the same reasons — and a site block in that Caddyfile, reaching `gamelog` by its service name:

```
gamelog.example.com {
	reverse_proxy gamelog:9999
}
```

## Installing as an app

Gamelog ships a web app manifest, so Chrome on Android can install it to the home screen as a standalone app, without the browser's address bar.

This only works over **HTTPS**. Browsers treat a plain `http://` page as insecure and, instead of installing the app, just add a shortcut that still opens in a browser tab. Serving Gamelog over HTTPS (see the reverse proxy examples above) is therefore what unlocks it. `http://localhost` is the one exception, which makes local development work.

To try it on a phone against an `http://` instance, without setting up HTTPS yet, open `chrome://flags/#unsafely-treat-insecure-origin-as-secure` in Chrome, add the instance's origin (for example `http://192.168.1.10:9999`), enable the flag and relaunch the browser. Only do this for your own server.

## Offline mode

When the server cannot be reached, Gamelog keeps working in **read-only** mode: the app opens from the copy kept on the device, with the library, the catalogues and the covers as they were the last time it reached the server. A strip at the top says so, and everything that would save a change (editing, creating, deleting, reordering, the account settings, signing out) stays disabled until the server answers again, which the app checks every few seconds. Nothing is queued to be sent later.

This works in a regular browser tab as well as in the installed app, on a phone or a computer, with a few conditions:

- It needs HTTPS (or `localhost`), like installing the app.
- The copy is per device and per browser, and is only there after signing in on it at least once while online. Signing out deletes it.
- Browsers may clear site data they consider unused. Gamelog asks for persistent storage, which an installed app usually gets; Safari in particular clears the data of a site that was not opened for a week otherwise.
- Private browsing windows keep nothing.

"Offline" means the server, not the device: a phone with a working connection that cannot reach a server running at home is offline too. An admin account has no library, so it gets nothing to read offline.

## Configuration

Everything is configured through environment variables. Every variable has a default aimed at local development, so only the ones that differ need to be set. See also [`.env.example`](../.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `GAMELOG_DB_HOST` | `127.0.0.1` | MariaDB host |
| `GAMELOG_DB_PORT` | `3306` | MariaDB port |
| `GAMELOG_DB_NAME` | `gamelog` | Database name |
| `GAMELOG_DB_USER` | `gamelog` | User |
| `GAMELOG_DB_PASSWORD` | `gamelog` | Password |
| `GAMELOG_SECURE_COOKIE` | `false` | Mark the session cookie `Secure`. Turn on when served over HTTPS |
| `GAMELOG_SESSION_LIFETIME` | `8760h` | How long a session lasts unused. It renews itself while in use |
| `GAMELOG_ADMIN_PASSWORD` | — | Creates the admin at startup, only on a deployment with no accounts |
| `GAMELOG_IMAGES_DIR` | `/data/images` in the image | Where uploaded images are stored, content-addressed by the sha256 of their bytes |
| `GAMELOG_MIGRATE` | `true` | Apply pending migrations at startup. Set to `false` to control when the schema changes yourself |
| `GAMELOG_DOCS` | `true` | Serve the interactive API documentation at `/api/docs` |
| `GAMELOG_IGDB_CLIENT_ID` | — | Client ID of a Twitch application, for looking games up on IGDB. See [Game metadata](#game-metadata-igdb) |
| `GAMELOG_IGDB_CLIENT_SECRET` | — | Its client secret. Set both or neither |
| `GAMELOG_STEAMGRIDDB_API_KEY` | — | A SteamGridDB API key, for searching cover images there as well. See [Cover image search](#cover-image-search) |
| `GAMELOG_PORT` | `8080` | Backend port. Inside the image it is an internal detail between Caddy and the backend: the container's public port is always 9999 |

The defaults are local development credentials. Change them before deploying anywhere, even behind Tailscale.

## Game metadata (IGDB)

The game form's **Identify** button looks the title up on [IGDB](https://www.igdb.com) and fills in the title, release date, developers and publishers. An empty field is filled in by default, and one already set is only replaced if you say so. It is optional and off by default: it only appears once the deployment has IGDB credentials.

IGDB is run by Twitch and authenticates through a Twitch application:

1. Sign in to the [Twitch developer console](https://dev.twitch.tv/console) with a Twitch account. Twitch asks for two-factor authentication to be turned on first.
2. Register an application. Any name will do; `http://localhost` is fine as the OAuth redirect URL, since it is never used; pick the _Confidential_ client type.
3. Copy its **Client ID**, generate a **Client Secret**, and set them as `GAMELOG_IGDB_CLIENT_ID` and `GAMELOG_IGDB_CLIENT_SECRET`.

The backend exchanges them for an access token on its own and renews it when it runs out, so there is nothing else to maintain. One application serves every account of the deployment, and the server needs outbound access to `id.twitch.tv` and `api.igdb.com`. The covers shown next to each result are loaded by the browser straight from `images.igdb.com`, only to tell the results apart: nothing from IGDB is stored but the fields you apply, and the cover you pick in the [image search](#cover-image-search).

When a developer or publisher is applied, Gamelog remembers which IGDB company it stands for, so the next game from the same company is recognised outright instead of guessed from its name. Several IGDB companies can point at the same record, which is how "Sony Computer Entertainment" and "Sony Interactive Entertainment" can both be your "Sony". These links travel with an [export](import-export.md) and a backup.

## Cover image search

The cover's **Search image** button looks the game's title up and shows its images to pick a cover from: heroes and grids (portrait and landscape) from [SteamGridDB](https://www.steamgriddb.com), and covers and artworks from IGDB. Each source configured gets a tab of its own, SteamGridDB's first and open by default, and the button only appears once at least one is. A game identified on IGDB shows the images of that game first; otherwise the top match for the title is shown, with the other matches a click away.

- **IGDB** needs nothing beyond the credentials of [Game metadata](#game-metadata-igdb).
- **SteamGridDB** needs an API key: sign in to SteamGridDB (with a Steam account), open the [API page of your preferences](https://www.steamgriddb.com/profile/preferences/api), generate a key and set it as `GAMELOG_STEAMGRIDDB_API_KEY`. Animated images and those marked NSFW are left out.

The thumbnails are loaded by the browser straight from IGDB and SteamGridDB, only to choose from. The picked image is downloaded by the backend and stored like an upload, so the library keeps its own copy and never depends on either site afterwards. The server needs outbound access to `www.steamgriddb.com` and its image CDN (`cdn2.steamgriddb.com`) for SteamGridDB, and to `images.igdb.com` for IGDB; images are only ever downloaded from those hosts.

## Accounts

Each account has a library of its own. Two people sharing a deployment are, in practice, two separate libraries sharing a process and a database: neither sees the other's games, genres, developers, publishers or platforms.

There are no roles. There is one account named `admin` that creates and removes the others and owns no library, and everybody else owns a library and manages nothing but their own profile and password. There is no self-registration: accounts exist because the admin created them.

**The first run.** While the database has no accounts, the application shows a "choose the admin password" form instead of a login screen, and it stops showing it the moment any account exists. For an unattended install, set `GAMELOG_ADMIN_PASSWORD` and the admin is created at startup instead — at the cost of a password sitting in a file.

**Sessions** are a random token in an `HttpOnly` cookie, stored hashed. They last a year by default (`GAMELOG_SESSION_LIFETIME`) and renew themselves while they are used, so in practice nobody is ever signed out. They are rows rather than self-contained tokens precisely so that they can be revoked: deleting an account ends its sessions immediately, and changing a password ends every session but the one that changed it.

Set `GAMELOG_SECURE_COOKIE=true` on any deployment served over HTTPS. It is off by default because a `Secure` cookie is never sent back over plain `http://`, which is how a Tailscale address is usually reached, and then nobody could log in at all.

**If the admin password is lost**, reset it from a shell in the container:

```sh
docker compose exec gamelog /app/server -reset-admin-password
```

It reads the new password from stdin and ends every session the account had.

## Backups

The **Account** page can download a full backup of your account as a `.zip` — every game, genre, developer, publisher and platform, your profile, plus every cover and avatar they use — and restore one, replacing what is there. It covers one account at a time; see [Import and export](import-export.md) for the details.

To back up a whole deployment, back up both volumes: the database (`db-data`, or a `mariadb-dump`) and `gamelog-data`, which holds the images.

## Stored images

Covers and avatars are stored as JPEG, PNG, WebP or GIF, judged from the file's bytes rather than its name. An upload in any other format the backend can read, which in practice means AVIF (what many websites serve, even when the saved file ends in `.png`), is converted on the way in: to JPEG, or to PNG when it has transparency. Restoring a backup converts the images it carries the same way.

Images uploaded before that conversion existed can still be AVIF under another name. They get no thumbnails, so the full image is sent and decoded wherever the cover is shown, which is slow on a phone. To find and convert them, see what would change first, then run it:

```sh
docker compose exec gamelog /app/server -normalize-images -dry-run
docker compose exec gamelog /app/server -normalize-images
```

Every converted image gets a new name, and the games and accounts that used it are moved to it; the old file and its thumbnails are deleted. A JPEG, PNG, WebP or GIF that was merely misnamed is renamed, never re-encoded. Running it again once there is nothing left to convert changes nothing.
