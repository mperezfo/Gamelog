-- +goose Up
-- A platform gets a colour, shown wherever a game's platform is: the table,
-- the dashboard, the calendar. Unlike icon, this only really makes
-- sense for platforms — a handful of well-known systems, not an open set of
-- names like genres or developers — so it is not on the other three tables.

ALTER TABLE platforms
    ADD COLUMN color VARCHAR(7) NULL AFTER icon;
