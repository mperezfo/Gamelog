-- +goose Up
-- A fourth per-account display preference, alongside theme, date_format and
-- games_view (see migrations 00010 and 00012): which dates the dashboard
-- calendar opens on, release dates or logged dates.

ALTER TABLE users
    ADD COLUMN calendar_view VARCHAR(8) NOT NULL DEFAULT 'release' AFTER games_view,
    ADD CONSTRAINT chk_users_calendar_view CHECK (calendar_view IN ('release', 'logged'));
