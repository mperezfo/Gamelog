# Gamelog

A self-hosted tracker for the video games I play: what I want to play, what I'm playing and what I've finished, with a score, a few notes, the platform, genres, developers, publishers and a cover for each one.

Gamelog is a personal project. I built it to track my own games, and it is tailored to exactly how I like to do that. Before Gamelog I used a Notion database, and before that, a plain Google Sheets spreadsheet.

I open sourced it in case it is useful to someone else too.

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
      # GAMELOG_SECURE_COOKIE: 'true' # once served over HTTPS
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

Since Gamelog is built around my own way of tracking games, I don't promise to accept pull requests for features I'm not personally interested in. Bug reports and fixes are welcome, though.

If you want it to work differently, please fork it! You are free to modify your fork and share it however you like.

## License

[MIT](LICENSE)
