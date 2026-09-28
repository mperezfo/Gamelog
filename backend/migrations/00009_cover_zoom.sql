-- +goose Up
-- How far to zoom in on the portrait crop, anchored at cover_focal_x/y.
-- 1 means no zoom (today's behaviour); null is treated the same as 1 by the
-- frontend. Only the portrait card (GameCoverCard) reads this.

ALTER TABLE games
    ADD COLUMN cover_zoom DECIMAL(3, 2) NULL AFTER cover_focal_y,
    ADD CONSTRAINT chk_games_cover_zoom CHECK (cover_zoom IS NULL OR (cover_zoom >= 1 AND cover_zoom <= 3));
