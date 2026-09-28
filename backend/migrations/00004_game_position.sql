-- +goose Up
-- Manual order within a status column, for the dashboard's drag-and-drop
-- board. It only ever breaks a tie: the board's primary order is
-- release_date descending, so this matters only among games that share a
-- date or have none at all — see the dashboard's sort comparator.
--
-- A float rather than an integer: reordering by drag-and-drop only ever needs
-- to place a card between its two new neighbours, which a float does by
-- averaging their positions. An integer would need periodic renumbering to
-- keep making room.

ALTER TABLE games
    ADD COLUMN position DOUBLE NOT NULL DEFAULT 0 AFTER status;

-- Existing rows get spread out by id, so a fresh deployment's board has a
-- stable, predictable order before anyone has dragged anything.
UPDATE games SET position = id;
