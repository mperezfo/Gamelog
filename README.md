# <img src="docs/images/logo.svg" alt="" width="36" height="36" align="top"> Gamelog

A self-hosted tracker for the video games I play: what I want to play, what I'm playing and what I've finished, with a score, a few notes, the platform, genres, developers, publishers and a cover for each one.

Gamelog is a personal project. I built it to track my own games, and it is tailored to exactly how I like to do that. Before Gamelog I used a Notion database, and before that, a plain Google Sheets spreadsheet.

I open sourced it in case it is useful to someone else too.

<p align="center">
  <img src="docs/screenshots/hero-dark.png" alt="The Gamelog dashboard on a desktop browser, with the games grid open on a phone next to it">
</p>

Here are [more screenshots](docs/screenshots.md), in desktop and phone formats.

## Features

- **Board**: Games grouped by status (Wishlist, Pending, Playing and Played), moved between columns by dragging.

- **Upcoming releases and calendar**: The next games due out, and a monthly calendar of release or play dates.

- **Stats**: What you have played over the years, with average scores and a breakdown by platform, genre, developer and publisher.

- **Covers**: Upload a cover, or pick one from IGDB or SteamGridDB, and frame it for portrait views. See [Cover image search](docs/self-hosting.md#cover-image-search).

- **Identify from IGDB**: Fill in a game's release date, platform, developers and publishers from [IGDB](https://www.igdb.com), and link it to its page there. See [Game metadata](docs/self-hosting.md#game-metadata-igdb).

- **Search and filters**: Search from any page, and filter the games list by status, platform, genre, developer, publisher, year or a field still left empty.

- **Installable and offline**: Add it to a phone's home screen as a PWA. Without a connection it still opens, read-only.

- **Export and backups**: Download your whole library, images included, as a `.zip` with the games in plain JSON, and restore it later.

- **Multiple accounts**: Each account has its own private library and settings.

- **Self-hosted**: A single Docker image next to MariaDB, with a documented REST API.

## Running it

Gamelog ships as a single Docker image and needs a MariaDB database next to it:

```yaml
services:
  gamelog:
    image: ghcr.io/mperezfo/gamelog:latest
    restart: unless-stopped
    init: true
    environment:
      GAMELOG_DB_HOST: db
      GAMELOG_DB_PASSWORD: change-me
      # GAMELOG_SECURE_COOKIE: 'true' # if served over HTTPS
      # Optional: look games up on IGDB and search cover images on IGDB and
      # SteamGridDB. See docs/self-hosting.md for how to get these.
      # GAMELOG_IGDB_CLIENT_ID: your-twitch-client-id
      # GAMELOG_IGDB_CLIENT_SECRET: your-twitch-client-secret
      # GAMELOG_STEAMGRIDDB_API_KEY: your-steamgriddb-api-key
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

Open <http://localhost:9999>. The first time it will ask you to choose a password for `admin`, the account that creates everybody else's. Make a regular account for yourself from there and sign in as that.

## Stack

- **Backend:** Go, [chi](https://github.com/go-chi/chi), [Huma](https://huma.rocks) (OpenAPI 3.1), [GORM](https://gorm.io) and [goose](https://github.com/pressly/goose)
- **Frontend:** React, TypeScript, Vite, TanStack Query and Tailwind CSS
- **Database:** MariaDB
- **Image:** Caddy serving the frontend and proxying `/api/*` to the backend

## More

Configuration, reverse proxy setups, import and export, the API and how to work on the code are all in [`docs/`](docs/).

## Contributing

Since Gamelog is built around my own way of tracking games, I don't promise to accept pull requests for features I'm not personally interested in. Bug reports and fixes are welcome, though, and the project's conventions are in [`AGENTS.md`](AGENTS.md).

If you want it to work differently, please fork it! You are free to modify your fork and share it however you like.

## License

[MIT](LICENSE)

The interface bundles the [Figtree](https://github.com/erikdkennedy/figtree) typeface and, for other scripts, Google's [Noto Sans](https://github.com/notofonts/latin-greek-cyrillic) and [Noto Sans CJK](https://github.com/notofonts/noto-cjk), all under the SIL Open Font License, and Google's [Noto Emoji](https://github.com/googlefonts/noto-emoji) images, under the Apache License 2.0.
