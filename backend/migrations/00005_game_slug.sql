-- +goose Up
-- The URL a game's own page is reached by, derived from its title (see
-- internal/slug). Nullable rather than backfilled here: generating it needs
-- the collision-avoidance logic that already lives in Go, so existing rows
-- are assigned one at startup instead of by this migration — see
-- ensureSlugs in cmd/server/main.go.
--
-- Unique per owner rather than globally: two accounts on the same deployment
-- are free to both have a game whose title folds to "doom".

ALTER TABLE games
    ADD COLUMN slug VARCHAR(300) NULL AFTER title,
    ADD UNIQUE KEY uk_games_user_slug (user_id, slug);
