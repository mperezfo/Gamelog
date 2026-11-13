-- +goose Up
-- A genre's icon gets a colour of its own, the way a platform has one (see
-- 00003), so that genres tell apart at a glance. It colours one of the
-- app's Tabler icons only: an emoji has colours of its own. Null keeps the
-- colour of the text around it.

ALTER TABLE genres
    ADD COLUMN color VARCHAR(7) NULL AFTER icon;
