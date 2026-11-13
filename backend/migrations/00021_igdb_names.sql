-- +goose Up
-- The names IGDB gives the companies and platforms a library links to (see
-- migrations 00016 and 00018), so that a link reads as "Capcom" straight
-- away, offline and without IGDB credentials too, rather than as company 37
-- until IGDB answers.
--
-- A copy of what IGDB says, not data of the library: one table for every
-- account, since an IGDB record has the same name for all of them, and no
-- part of a backup. Only the server writes it, from what IGDB itself
-- answered: a search, a lookup of names (which also corrects a name IGDB
-- has changed since), or the startup pass that names the links made before
-- this table existed. A row may outlive every link to its record, which
-- costs nothing and saves asking IGDB again if it is linked once more.

CREATE TABLE igdb_names (
    kind    ENUM('company', 'platform') NOT NULL,
    igdb_id BIGINT UNSIGNED             NOT NULL,
    name    VARCHAR(255)                NOT NULL,
    PRIMARY KEY (kind, igdb_id)
) ENGINE = InnoDB;
