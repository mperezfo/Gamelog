-- +goose Up
-- Initial schema for the entities.
--
-- Charset and collation are left to the database default, which on MariaDB
-- 11.4 is utf8mb4 / utf8mb4_uca1400_ai_ci: case- and accent-insensitive. That
-- is deliberate for the name columns below, so "nintendo" and "Nintendo" (or
-- "Pokemon" and "Pokémon") collide in the UNIQUE indexes instead of creating
-- duplicate entries.

CREATE TABLE platforms (
    id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(100) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_platforms_name (name)
) ENGINE = InnoDB;

CREATE TABLE genres (
    id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(100) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_genres_name (name)
) ENGINE = InnoDB;

CREATE TABLE developers (
    id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    icon VARCHAR(100) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_developers_name (name)
) ENGINE = InnoDB;

CREATE TABLE publishers (
    id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(150) NOT NULL,
    icon VARCHAR(100) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_publishers_name (name)
) ENGINE = InnoDB;

CREATE TABLE games (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title           VARCHAR(255) NOT NULL,
    status          VARCHAR(16) NOT NULL,
    -- DECIMAL rather than FLOAT: scores are 0.0-10.0 with one decimal and are
    -- sorted and compared for equality, where binary floats are inexact.
    score           DECIMAL(3, 1) NULL,
    tagline         VARCHAR(255) NULL,
    notes           TEXT NULL,
    cover_image_url VARCHAR(2048) NULL,
    release_date    DATE NULL,
    logged_date     DATE NULL,
    platform_id     BIGINT UNSIGNED NULL,
    created_at      DATETIME(3) NOT NULL,
    updated_at      DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    -- Deleting a platform must not delete the games played on it.
    CONSTRAINT fk_games_platform FOREIGN KEY (platform_id)
        REFERENCES platforms (id) ON DELETE SET NULL,
    -- Must stay in sync with models.Statuses().
    CONSTRAINT chk_games_status CHECK (status IN ('wishlist', 'pending', 'playing', 'played')),
    CONSTRAINT chk_games_score CHECK (score IS NULL OR (score >= 0 AND score <= 10)),
    KEY idx_games_status (status),
    KEY idx_games_title (title),
    KEY idx_games_score (score),
    KEY idx_games_release_date (release_date),
    KEY idx_games_logged_date (logged_date)
) ENGINE = InnoDB;

CREATE TABLE game_genres (
    game_id  BIGINT UNSIGNED NOT NULL,
    genre_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (game_id, genre_id),
    KEY idx_game_genres_genre (genre_id),
    CONSTRAINT fk_game_genres_game FOREIGN KEY (game_id)
        REFERENCES games (id) ON DELETE CASCADE,
    CONSTRAINT fk_game_genres_genre FOREIGN KEY (genre_id)
        REFERENCES genres (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE game_developers (
    game_id      BIGINT UNSIGNED NOT NULL,
    developer_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (game_id, developer_id),
    KEY idx_game_developers_developer (developer_id),
    CONSTRAINT fk_game_developers_game FOREIGN KEY (game_id)
        REFERENCES games (id) ON DELETE CASCADE,
    CONSTRAINT fk_game_developers_developer FOREIGN KEY (developer_id)
        REFERENCES developers (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE game_publishers (
    game_id      BIGINT UNSIGNED NOT NULL,
    publisher_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (game_id, publisher_id),
    KEY idx_game_publishers_publisher (publisher_id),
    CONSTRAINT fk_game_publishers_game FOREIGN KEY (game_id)
        REFERENCES games (id) ON DELETE CASCADE,
    CONSTRAINT fk_game_publishers_publisher FOREIGN KEY (publisher_id)
        REFERENCES publishers (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- +goose Down
DROP TABLE game_publishers;
DROP TABLE game_developers;
DROP TABLE game_genres;
DROP TABLE games;
DROP TABLE publishers;
DROP TABLE developers;
DROP TABLE genres;
DROP TABLE platforms;
