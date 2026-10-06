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
      GAMELOG_SECURE_COOKIE: "true" # once served over HTTPS
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

There is no offline mode: Gamelog needs its API for everything, so the app still needs a connection.

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
| `GAMELOG_NTFY_URL` | none | Base URL of the [ntfy](https://ntfy.sh) server release reminders are sent through. Without it the ntfy channel is not offered. See [Release reminders](#release-reminders) |
| `GAMELOG_NTFY_TOKEN` | none | Access token for that ntfy server, if it needs one |
| `GAMELOG_NOTIFY_HOUR` | `9` | Hour of the day, in the server's time zone, from which the day's reminders go out |
| `TZ` | `UTC` | The server's time zone, such as `Europe/Madrid`. It decides which day it is for release dates, and when `GAMELOG_NOTIFY_HOUR` falls |
| `GAMELOG_PORT` | `8080` | Backend port. Inside the image it is an internal detail between Caddy and the backend: the container's public port is always 9999 |

The defaults are local development credentials. Change them before deploying anywhere, even behind Tailscale.

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

## Release reminders

Each account can be reminded that a game in its library is about to come out, using the release date saved on the game. A reminder is sent a number of days ahead, which each account chooses, and again on the day itself. Games already marked as played are left out, and a game whose date is moved is announced again for the new one.

What a deployment can reach is up to the administrator, through configuration. Each account then switches the available channels on or off from its own page and fills in whatever they need, such as an ntfy topic. An account only ever picks where its reminders go, never which server they go through, so nobody can make the backend call an address of their own. The channel is not listed for accounts at all until it is configured.

The only channel so far is ntfy. Point `GAMELOG_NTFY_URL` at a server you run or at `https://ntfy.sh`, and set `GAMELOG_NTFY_TOKEN` if the server requires authentication:

```yaml
environment:
  GAMELOG_NTFY_URL: https://ntfy.example.com
  GAMELOG_NTFY_TOKEN: tk_changeme
  TZ: Europe/Madrid
```

Each account chooses a topic and subscribes to it in the ntfy app. Anyone who knows a topic on a server that is open can read it, so pick one that is hard to guess. The "Send a test" button on the account page delivers a message with the saved settings, so a typo shows up straight away.

Reminders are sent by the backend itself, which checks every 15 minutes and sends nothing before `GAMELOG_NOTIFY_HOUR`. Set `TZ` to your own time zone, or "today" and that hour are in UTC. A reminder that could not be delivered is tried again on the next check, and one that was delivered is never repeated. If the backend is down for a whole day, the reminders of that day are not sent afterwards.

## Backups

The **Account** page can download a full backup of your account as a `.zip` — every game, genre, developer, publisher and platform, your profile, plus every cover and avatar they use — and restore one, replacing what is there. It covers one account at a time; see [Import and export](import-export.md) for the details.

To back up a whole deployment, back up both volumes: the database (`db-data`, or a `mariadb-dump`) and `gamelog-data`, which holds the images.
