-- +goose Up
-- Set when the stored password hash was written by restoring a backup
-- (POST /api/backup) rather than chosen through the application. The auth
-- middleware refuses every request but the ones about the session itself
-- until the account changes its password, since a backup can be stale or
-- have reached somebody it should not have.

ALTER TABLE users
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER password_hash;
