-- +goose Up
-- Where a portrait crop of the cover should be centred, as a fraction of the
-- image's width and height (0 = left/top edge, 1 = right/bottom edge). Every
-- landscape rendering of the cover stays centred as before; only the
-- portrait card (GameCoverCard) reads these. Null means "centre", today's
-- behaviour, so existing covers need no backfill.
--
-- Two columns rather than one JSON/point column: they are read independently
-- as plain floats by the frontend's object-position, and a pair of nullable
-- DECIMALs needs no encoding/decoding on either side.

ALTER TABLE games
    ADD COLUMN cover_focal_x DECIMAL(5, 4) NULL AFTER cover_image_url,
    ADD COLUMN cover_focal_y DECIMAL(5, 4) NULL AFTER cover_focal_x,
    ADD CONSTRAINT chk_games_cover_focal_x CHECK (cover_focal_x IS NULL OR (cover_focal_x >= 0 AND cover_focal_x <= 1)),
    ADD CONSTRAINT chk_games_cover_focal_y CHECK (cover_focal_y IS NULL OR (cover_focal_y >= 0 AND cover_focal_y <= 1));
