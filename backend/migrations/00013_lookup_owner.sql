-- +goose Up
-- Platforms, genres, developers and publishers stop being shared across every
-- account and become part of one user's library, same as a game already is:
-- a brand-new account must start with an entirely blank app, not see records
-- somebody else created.
--
-- Existing rows are attributed to whoever already plays a game that names
-- them (a genre used by several games keeps a single owner: the one with the
-- lowest id). A row nothing points at — including every one of these four
-- tables on a deployment with no games yet — has nobody to attribute it to,
-- so it goes to the first non-admin account, the same fallback migration
-- 00002 uses for a game that predates authentication; if somehow only the
-- admin exists, it goes there instead rather than fail the migration.

ALTER TABLE platforms ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE genres ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE developers ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id;
ALTER TABLE publishers ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id;

UPDATE platforms p
    LEFT JOIN (
        SELECT platform_id, MIN(user_id) AS user_id
        FROM games
        WHERE platform_id IS NOT NULL AND user_id IS NOT NULL
        GROUP BY platform_id
    ) owned ON owned.platform_id = p.id
    SET p.user_id = COALESCE(owned.user_id, (SELECT id FROM users ORDER BY is_admin ASC, id ASC LIMIT 1));

UPDATE genres gr
    LEFT JOIN (
        SELECT gg.genre_id, MIN(g.user_id) AS user_id
        FROM game_genres gg
        JOIN games g ON g.id = gg.game_id
        WHERE g.user_id IS NOT NULL
        GROUP BY gg.genre_id
    ) owned ON owned.genre_id = gr.id
    SET gr.user_id = COALESCE(owned.user_id, (SELECT id FROM users ORDER BY is_admin ASC, id ASC LIMIT 1));

UPDATE developers d
    LEFT JOIN (
        SELECT gd.developer_id, MIN(g.user_id) AS user_id
        FROM game_developers gd
        JOIN games g ON g.id = gd.game_id
        WHERE g.user_id IS NOT NULL
        GROUP BY gd.developer_id
    ) owned ON owned.developer_id = d.id
    SET d.user_id = COALESCE(owned.user_id, (SELECT id FROM users ORDER BY is_admin ASC, id ASC LIMIT 1));

UPDATE publishers pb
    LEFT JOIN (
        SELECT gp.publisher_id, MIN(g.user_id) AS user_id
        FROM game_publishers gp
        JOIN games g ON g.id = gp.game_id
        WHERE g.user_id IS NOT NULL
        GROUP BY gp.publisher_id
    ) owned ON owned.publisher_id = pb.id
    SET pb.user_id = COALESCE(owned.user_id, (SELECT id FROM users ORDER BY is_admin ASC, id ASC LIMIT 1));

-- The name and slug were unique per deployment; they become unique per
-- owner instead, so two accounts can each have their own "RPG".
ALTER TABLE platforms
    MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL,
    ADD KEY idx_platforms_user (user_id),
    ADD CONSTRAINT fk_platforms_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    DROP KEY uk_platforms_name,
    DROP KEY uk_platforms_slug,
    ADD UNIQUE KEY uk_platforms_owner_name (user_id, name),
    ADD UNIQUE KEY uk_platforms_owner_slug (user_id, slug);

ALTER TABLE genres
    MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL,
    ADD KEY idx_genres_user (user_id),
    ADD CONSTRAINT fk_genres_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    DROP KEY uk_genres_name,
    DROP KEY uk_genres_slug,
    ADD UNIQUE KEY uk_genres_owner_name (user_id, name),
    ADD UNIQUE KEY uk_genres_owner_slug (user_id, slug);

ALTER TABLE developers
    MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL,
    ADD KEY idx_developers_user (user_id),
    ADD CONSTRAINT fk_developers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    DROP KEY uk_developers_name,
    DROP KEY uk_developers_slug,
    ADD UNIQUE KEY uk_developers_owner_name (user_id, name),
    ADD UNIQUE KEY uk_developers_owner_slug (user_id, slug);

ALTER TABLE publishers
    MODIFY COLUMN user_id BIGINT UNSIGNED NOT NULL,
    ADD KEY idx_publishers_user (user_id),
    ADD CONSTRAINT fk_publishers_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    DROP KEY uk_publishers_name,
    DROP KEY uk_publishers_slug,
    ADD UNIQUE KEY uk_publishers_owner_name (user_id, name),
    ADD UNIQUE KEY uk_publishers_owner_slug (user_id, slug);
