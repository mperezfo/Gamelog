-- +goose Up
-- The name shown in the application, separate from the username used to sign
-- in — the login screen is unlikely to change once chosen, but a name is the
-- kind of thing somebody wants to update without it looking like a different
-- account. Backfilled from the username that already exists, then tightened
-- to NOT NULL once every row has one.
--
-- avatar_url points at an uploaded image the same way a game's
-- cover_image_url does (see the Images tag) — no separate storage, just
-- another use of the same upload endpoint.

ALTER TABLE users
    ADD COLUMN name VARCHAR(100) NULL AFTER username,
    ADD COLUMN avatar_url VARCHAR(2048) NULL AFTER name;

UPDATE users SET name = username WHERE name IS NULL;

ALTER TABLE users MODIFY COLUMN name VARCHAR(100) NOT NULL;
