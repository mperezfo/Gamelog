-- +goose Up
-- A fifth per-account display preference, and the first that holds a list:
-- which kinds of record the global search leaves out (games, developers,
-- publishers, platforms, genres). The kinds left out rather than the ones
-- shown, so that a kind the search learns later is searched for everyone.
-- What the list may hold is checked in Go (see models.Preferences); the
-- column only has to be JSON, which MariaDB's JSON type checks by itself.

ALTER TABLE users
    ADD COLUMN search_hidden JSON NOT NULL DEFAULT '[]' AFTER calendar_view;
