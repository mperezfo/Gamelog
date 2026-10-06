-- +goose Up
-- Release reminders: where each account wants to be told about the games that
-- are about to come out, and a record of what it has already been told.

-- One row per account and channel type ('ntfy', ...). The set of types is
-- fixed by the code and by what the administrator enabled, so there is no
-- constraint on it here: a type the deployment stops offering simply goes
-- quiet, and its row waits in case it is offered again.
--
-- settings holds what the channel needs to reach this account (an ntfy topic,
-- say), as a JSON object of strings. Its shape belongs to the channel, which
-- validates it on the way in; the schema only guarantees it is an object.
-- days_before is how many days ahead of a release the reminder goes out, 0
-- meaning no advance reminder, only the one on the day.
CREATE TABLE notification_channels (
    user_id     BIGINT UNSIGNED NOT NULL,
    type        VARCHAR(32) NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    days_before TINYINT UNSIGNED NOT NULL DEFAULT 3,
    settings    JSON NOT NULL,
    created_at  DATETIME(3) NOT NULL,
    updated_at  DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, type),
    CONSTRAINT chk_notification_channels_days_before CHECK (days_before <= 30),
    CONSTRAINT fk_notification_channels_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- Every reminder that went out, so that none goes out twice. release_date is
-- part of the key on purpose: when a game's date is moved, the reminders for
-- the new date are new reminders.
CREATE TABLE notification_log (
    user_id      BIGINT UNSIGNED NOT NULL,
    game_id      BIGINT UNSIGNED NOT NULL,
    channel_type VARCHAR(32) NOT NULL,
    kind         VARCHAR(8) NOT NULL,
    release_date DATE NOT NULL,
    sent_at      DATETIME(3) NOT NULL,
    PRIMARY KEY (user_id, game_id, channel_type, kind, release_date),
    KEY idx_notification_log_game (game_id),
    CONSTRAINT chk_notification_log_kind CHECK (kind IN ('reminder', 'release')),
    CONSTRAINT fk_notification_log_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notification_log_game FOREIGN KEY (game_id)
        REFERENCES games (id) ON DELETE CASCADE
) ENGINE = InnoDB;

-- +goose Down
DROP TABLE notification_log;
DROP TABLE notification_channels;
