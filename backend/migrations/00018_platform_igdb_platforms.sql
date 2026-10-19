-- +goose Up
-- Remembers which IGDB platforms a platform stands for, the way migration
-- 00016 does for developers and publishers, so that Identify recognises the
-- library's "PS5" as IGDB's "PlayStation 5" without guessing from the name.
--
-- Unlike a company, an IGDB platform can stand for several records at once:
-- a library may file some PC games under "Steam Deck" and keep "PC" for the
-- rest, while IGDB knows both as "PC (Microsoft Windows)". And a record can
-- stand for several IGDB platforms ("VR" for Meta Quest 2, PlayStation VR2,
-- ...). So the key is the whole pair, and a new link never moves an old one:
-- Identify suggests the most used of the records an IGDB platform is linked
-- to.

CREATE TABLE platform_igdb_platforms (
    user_id          BIGINT UNSIGNED NOT NULL,
    igdb_platform_id BIGINT UNSIGNED NOT NULL,
    platform_id      BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, igdb_platform_id, platform_id),
    KEY idx_platform_igdb_platforms_platform (platform_id),
    CONSTRAINT fk_platform_igdb_platforms_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_platform_igdb_platforms_platform FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE CASCADE
) ENGINE = InnoDB;
