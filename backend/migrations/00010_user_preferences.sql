-- +goose Up
-- Two per-account display preferences: the theme (light/dark/system) and how
-- a date is written out. Both used to live in the browser alone; they moved
-- here so they travel with the account across devices and can be part of the
-- library export/import, same as everything else on the profile page.

-- date_format is one of a fixed set of layouts the frontend knows how to
-- render ('long' = "Dec 31, 2023", 'ymd' = "2023/12/31", 'dmy' =
-- "31/12/2023", 'mdy' = "12/31/2023") rather than a free-form pattern: there
-- is nothing on either side that needs to parse an arbitrary date template.

ALTER TABLE users
    ADD COLUMN theme VARCHAR(8) NOT NULL DEFAULT 'system' AFTER avatar_url,
    ADD COLUMN date_format VARCHAR(8) NOT NULL DEFAULT 'long' AFTER theme,
    ADD CONSTRAINT chk_users_theme CHECK (theme IN ('light', 'dark', 'system')),
    ADD CONSTRAINT chk_users_date_format CHECK (date_format IN ('long', 'ymd', 'dmy', 'mdy'));
