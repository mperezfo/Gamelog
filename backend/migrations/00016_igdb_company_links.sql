-- +goose Up
-- Remembers which IGDB company a developer or publisher stands for, so that
-- identifying a game a second time recognises the company outright instead
-- of guessing from its name.
--
-- A table rather than a column on developers/publishers: IGDB tends to list
-- one real company under several entries over the years (Sony Computer
-- Entertainment, Sony Interactive Entertainment, ...), and a library is free
-- to file them all under a single "Sony". So one record can carry many IGDB
-- companies, while an IGDB company stands for at most one record per account,
-- which the primary key enforces. The owner is repeated here, rather than
-- reached through the developer, for that key to be possible at all.
--
-- Developers and publishers stay two tables, like everything else about
-- them: the same IGDB company is usually both, and a library keeps the two
-- roles as separate records.

CREATE TABLE developer_igdb_companies (
    user_id         BIGINT UNSIGNED NOT NULL,
    igdb_company_id BIGINT UNSIGNED NOT NULL,
    developer_id    BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, igdb_company_id),
    KEY idx_developer_igdb_companies_developer (developer_id),
    CONSTRAINT fk_developer_igdb_companies_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_developer_igdb_companies_developer FOREIGN KEY (developer_id) REFERENCES developers (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE publisher_igdb_companies (
    user_id         BIGINT UNSIGNED NOT NULL,
    igdb_company_id BIGINT UNSIGNED NOT NULL,
    publisher_id    BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, igdb_company_id),
    KEY idx_publisher_igdb_companies_publisher (publisher_id),
    CONSTRAINT fk_publisher_igdb_companies_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_publisher_igdb_companies_publisher FOREIGN KEY (publisher_id) REFERENCES publishers (id) ON DELETE CASCADE
) ENGINE = InnoDB;
