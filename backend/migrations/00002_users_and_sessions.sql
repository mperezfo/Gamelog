-- +goose Up
-- Authentication: accounts, sessions, and the owner of a game.
--
-- Like the initial schema, the charset and collation are left to the database
-- default (utf8mb4 / utf8mb4_uca1400_ai_ci, case- and accent-insensitive).
-- That is deliberate for `username`: "Martin", "martin" and "martín" are the
-- same account, so logging in does not depend on remembering which one was
-- typed on the day the account was created.

CREATE TABLE users (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username      VARCHAR(64) NOT NULL,
    -- bcrypt output is 60 characters today; the column leaves room for the
    -- longer encodings a future algorithm would write.
    password_hash VARCHAR(255) NOT NULL,
    -- The only privilege there is. An admin manages the other accounts and
    -- owns no games; see the authentication section of the spec.
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    DATETIME(3) NOT NULL,
    updated_at    DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_users_username (username)
) ENGINE = InnoDB;

CREATE TABLE sessions (
    -- SHA-256 of the session token. The token itself is never stored: it only
    -- ever exists in the cookie, so a leaked backup of this table does not
    -- hand over live sessions. A plain hash is the right one here because the
    -- token is already 32 random bytes — there is no guessing to slow down.
    token_hash   BINARY(32) NOT NULL,
    user_id      BIGINT UNSIGNED NOT NULL,
    created_at   DATETIME(3) NOT NULL,
    last_used_at DATETIME(3) NOT NULL,
    expires_at   DATETIME(3) NOT NULL,
    PRIMARY KEY (token_hash),
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires_at (expires_at),
    -- Deleting a user ends every session they had, immediately. That is the
    -- reason sessions are rows rather than self-contained tokens.
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Each game belongs to one user, and every query the game repository makes is
-- scoped to the session's user.
--
-- The column is NULL-able for exactly one reason: a deployment that already
-- holds games has no user to attribute them to at the moment this migration
-- runs, and a migration that fails on real data is worse than a nullable
-- column. Those rows are adopted by the first non-admin account created (see
-- repository.UserRepository.Create); after that, nothing is left unowned, and
-- a row without an owner is invisible to every API caller in the meantime.
ALTER TABLE games
    ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id,
    ADD KEY idx_games_user (user_id),
    ADD CONSTRAINT fk_games_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE games DROP FOREIGN KEY fk_games_user;
ALTER TABLE games DROP KEY idx_games_user;
ALTER TABLE games DROP COLUMN user_id;
DROP TABLE sessions;
DROP TABLE users;
