-- +goose Up
-- The Games page's saved views: a list of named query strings, each holding
-- a set of filters, the search, the sort and the layout, kept with the
-- account so that they are the same on every device. Like search_hidden
-- (migration 00020) the column only has to be JSON; what each view may hold
-- is checked in Go (see models.SavedView).

ALTER TABLE users
    ADD COLUMN saved_views JSON NOT NULL DEFAULT '[]' AFTER search_hidden;
