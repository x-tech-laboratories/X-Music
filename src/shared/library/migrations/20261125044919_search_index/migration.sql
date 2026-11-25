-- The searchable text of each track kept in a plain table with a lasting integer key, which the full-text index reads
-- from. Triggers only note which tracks changed; the store rebuilds those rows in one pass before it next searches.
DROP TABLE `tracks_fts`;
--> statement-breakpoint
CREATE TABLE `track_search` (
	`row` integer PRIMARY KEY,
	`track_id` text NOT NULL UNIQUE REFERENCES `tracks`(`id`) ON DELETE CASCADE,
	`title` text, `artist` text, `album` text, `album_artist` text, `genre` text, `comment` text, `lyrics` text
);
--> statement-breakpoint
CREATE TABLE `track_search_stale` (
	`track_id` text PRIMARY KEY
) WITHOUT ROWID;
--> statement-breakpoint
CREATE VIRTUAL TABLE `tracks_fts` USING fts5(
	title, artist, album, album_artist, genre, comment, lyrics,
	content = 'track_search', content_rowid = 'row',
	tokenize = "unicode61 remove_diacritics 2"
);
--> statement-breakpoint
CREATE VIEW `track_search_source` AS SELECT
	t.id AS track_id,
	t.title AS title,
	(SELECT group_concat(v.value, ' ') FROM `track_values` tv JOIN `values_` v ON v.id = tv.value_id WHERE tv.track_id = t.id AND +tv.field_id = 1) AS artist,
	(SELECT a.name FROM `albums` a WHERE a.id = t.album_id) AS album,
	(SELECT group_concat(v.value, ' ') FROM `track_values` tv JOIN `values_` v ON v.id = tv.value_id WHERE tv.track_id = t.id AND +tv.field_id = 2) AS album_artist,
	(SELECT group_concat(v.value, ' ') FROM `track_values` tv JOIN `values_` v ON v.id = tv.value_id WHERE tv.track_id = t.id AND +tv.field_id = 4) AS genre,
	(SELECT e.value FROM `track_extras` e WHERE e.track_id = t.id AND e.field_id = 20) AS comment,
	(SELECT e.value FROM `track_extras` e WHERE e.track_id = t.id AND e.field_id = 21) AS lyrics
FROM `tracks` t;
--> statement-breakpoint
CREATE TRIGGER `track_search_added` AFTER INSERT ON `track_search` BEGIN
	INSERT INTO `tracks_fts` (rowid, title, artist, album, album_artist, genre, comment, lyrics) VALUES (new.row, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment, new.lyrics);
END;
--> statement-breakpoint
CREATE TRIGGER `track_search_removed` AFTER DELETE ON `track_search` BEGIN
	INSERT INTO `tracks_fts` (tracks_fts, rowid, title, artist, album, album_artist, genre, comment, lyrics) VALUES ('delete', old.row, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment, old.lyrics);
END;
--> statement-breakpoint
CREATE TRIGGER `track_search_changed` AFTER UPDATE ON `track_search` BEGIN
	INSERT INTO `tracks_fts` (tracks_fts, rowid, title, artist, album, album_artist, genre, comment, lyrics) VALUES ('delete', old.row, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment, old.lyrics);
	INSERT INTO `tracks_fts` (rowid, title, artist, album, album_artist, genre, comment, lyrics) VALUES (new.row, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment, new.lyrics);
END;
--> statement-breakpoint
CREATE TRIGGER `search_track_added` AFTER INSERT ON `tracks` BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_track_changed` AFTER UPDATE OF title, album_id ON `tracks` BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (new.id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_track_removed` AFTER DELETE ON `tracks` BEGIN
	DELETE FROM `track_search` WHERE track_id = old.id;
	DELETE FROM `track_search_stale` WHERE track_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_value_added` AFTER INSERT ON `track_values` WHEN new.field_id IN (1, 2, 4) BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (new.track_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_value_removed` AFTER DELETE ON `track_values` WHEN old.field_id IN (1, 2, 4) BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (old.track_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_value_changed` AFTER UPDATE ON `track_values` WHEN new.field_id IN (1, 2, 4) OR old.field_id IN (1, 2, 4) BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (old.track_id), (new.track_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_extra_added` AFTER INSERT ON `track_extras` WHEN new.field_id IN (20, 21) BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (new.track_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_extra_removed` AFTER DELETE ON `track_extras` WHEN old.field_id IN (20, 21) BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (old.track_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_extra_changed` AFTER UPDATE ON `track_extras` WHEN new.field_id IN (20, 21) OR old.field_id IN (20, 21) BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) VALUES (old.track_id), (new.track_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_album_renamed` AFTER UPDATE OF name ON `albums` BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) SELECT id FROM `tracks` WHERE album_id = new.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_value_renamed` AFTER UPDATE OF value ON `values_` WHEN new.field_id IN (1, 2, 4) BEGIN
	INSERT OR IGNORE INTO `track_search_stale` (track_id) SELECT track_id FROM `track_values` WHERE value_id = new.id;
END;
--> statement-breakpoint
INSERT INTO `track_search` (track_id, title, artist, album, album_artist, genre, comment, lyrics) SELECT track_id, title, artist, album, album_artist, genre, comment, lyrics FROM `track_search_source` WHERE true;
