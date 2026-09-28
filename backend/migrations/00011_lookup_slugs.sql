-- +goose Up
-- The same URL-friendly slug a game gets (see migration 00005 and
-- internal/slug), derived from the name, for the other four things a game
-- points at: nothing about them should surface an internal numeric id
-- anywhere the application shows a URL.
--
-- Nullable rather than backfilled here for the same reason as the game
-- slug: generating one needs the collision-avoidance logic that lives in Go
-- (LookupRepository.assignSlug), not a SQL migration. Existing rows are
-- assigned one at startup — see backfillSlugs in cmd/server/main.go.
--
-- Unique globally rather than per-owner: unlike a game, these four are
-- shared across every account on the deployment.

ALTER TABLE platforms
    ADD COLUMN slug VARCHAR(150) NULL AFTER name,
    ADD UNIQUE KEY uk_platforms_slug (slug);

ALTER TABLE genres
    ADD COLUMN slug VARCHAR(150) NULL AFTER name,
    ADD UNIQUE KEY uk_genres_slug (slug);

ALTER TABLE developers
    ADD COLUMN slug VARCHAR(200) NULL AFTER name,
    ADD UNIQUE KEY uk_developers_slug (slug);

ALTER TABLE publishers
    ADD COLUMN slug VARCHAR(200) NULL AFTER name,
    ADD UNIQUE KEY uk_publishers_slug (slug);
