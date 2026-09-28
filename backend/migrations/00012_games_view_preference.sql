-- +goose Up
-- A third per-account display preference, alongside theme and date_format
-- (see migration 00010): which of the Games page's two layouts — the table
-- or the cover grid — opens by default when the URL carries no `view` of its
-- own.

ALTER TABLE users
    ADD COLUMN games_view VARCHAR(8) NOT NULL DEFAULT 'table' AFTER date_format,
    ADD CONSTRAINT chk_users_games_view CHECK (games_view IN ('table', 'grid'));
