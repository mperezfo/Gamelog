-- +goose Up
-- Where a developer or a publisher is from, in place of the free emoji they
-- carried as an icon, which said little about a company. Shown as a flag.
--
-- An ISO 3166-1 two-letter code ("ES"), filled from IGDB when Identify links
-- the record to an IGDB company, or set by hand. Null when nobody knows.
-- Genres and platforms keep their icon.

ALTER TABLE developers
    DROP COLUMN icon,
    ADD COLUMN country CHAR(2) NULL AFTER slug;

ALTER TABLE publishers
    DROP COLUMN icon,
    ADD COLUMN country CHAR(2) NULL AFTER slug;

-- The jobs the server runs once, at startup, when the deployment is ready
-- for them, rather than in a migration: filling in the countries of the
-- records already linked to IGDB needs IGDB, which a migration cannot reach
-- and a deployment may not be configured for yet. A row is a job done, so
-- that it never runs again, not even over a country cleared by hand since.

CREATE TABLE startup_jobs (
    name         VARCHAR(100) NOT NULL,
    completed_at DATETIME     NOT NULL,
    PRIMARY KEY (name)
) ENGINE = InnoDB;
