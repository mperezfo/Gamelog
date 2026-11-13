-- +goose Up
-- A platform shows its colour, not an emoji: the app has had no way to set
-- or clear a platform's icon for a while, and only an import or a direct API
-- call could still give it one. Dropped the way 00019 dropped the icon of
-- developers and publishers. Genres keep theirs.

ALTER TABLE platforms
    DROP COLUMN icon;
