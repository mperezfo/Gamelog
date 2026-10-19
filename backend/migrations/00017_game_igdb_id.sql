-- +goose Up
-- The IGDB game a game was identified as, from the game form's Identify, so
-- that it can link to the game's page on IGDB and Identify can tell which of
-- its results is the game already.
--
-- Not unique: nothing stops two games of a library from being the same IGDB
-- game, and the form only warns about it. The index serves that warning's
-- question, which games of an account have a given IGDB id.

ALTER TABLE games
    ADD COLUMN igdb_id BIGINT UNSIGNED NULL AFTER platform_id,
    ADD KEY idx_games_user_igdb (user_id, igdb_id);
