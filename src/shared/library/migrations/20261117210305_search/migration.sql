-- Full-text search over the tracks, keyed by the track's id; Drizzle has no builder for a virtual table.
CREATE VIRTUAL TABLE `tracks_fts` USING fts5(
	track_id UNINDEXED, title, artist, album, album_artist, genre, comment, lyrics,
	tokenize = "unicode61 remove_diacritics 2"
);
