CREATE TABLE `albums` (
	`id` text PRIMARY KEY,
	`match_key` text NOT NULL UNIQUE,
	`pinned` integer DEFAULT 0 NOT NULL,
	`name` text,
	`edition` text,
	`album_artist_id` text,
	`year` integer,
	`disc_total` integer,
	`mb_release_id` text,
	`mb_release_group_id` text,
	`is_compilation` integer DEFAULT 0 NOT NULL,
	`rg_album_gain` real,
	`added` integer NOT NULL,
	CONSTRAINT `fk_albums_album_artist_id_values__id_fk` FOREIGN KEY (`album_artist_id`) REFERENCES `values_`(`id`) ON DELETE SET NULL,
	CONSTRAINT "albums_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `artwork` (
	`id` text PRIMARY KEY,
	`album_id` text,
	`track_id` text,
	`source` text NOT NULL,
	`origin` text,
	`hash` text,
	`path` text,
	`width` integer,
	`height` integer,
	`bytes` integer,
	`found_at` integer NOT NULL,
	CONSTRAINT `fk_artwork_album_id_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_artwork_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "artwork_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY,
	`track_id` text NOT NULL,
	`kind` text NOT NULL,
	`uri` text NOT NULL,
	`provider` text,
	`subtrack_index` integer DEFAULT 0 NOT NULL,
	`start_ms` integer,
	`end_ms` integer,
	`audio_hash` blob,
	`audio_hash_algo` text,
	`codec` text,
	`container` text,
	`bitrate` integer,
	`bitrate_mode` text,
	`samplerate` integer,
	`channels` integer,
	`bits_per_sample` integer,
	`filesize` integer,
	`mtime` integer,
	`present` integer DEFAULT 1 NOT NULL,
	`last_seen` integer,
	`quality_rank` integer DEFAULT 0 NOT NULL,
	`added` integer NOT NULL,
	CONSTRAINT `fk_media_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "media_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `media_tags` (
	`media_id` text NOT NULL,
	`field_id` integer NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`value` text,
	CONSTRAINT `media_tags_pk` PRIMARY KEY(`media_id`, `field_id`, `ordinal`),
	CONSTRAINT `fk_media_tags_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `merge_journal` (
	`id` text PRIMARY KEY,
	`batch_id` text NOT NULL,
	`at` integer NOT NULL,
	`survivor_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`undone` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "merge_journal_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `play_history` (
	`id` text PRIMARY KEY,
	`track_id` text NOT NULL,
	`media_id` text,
	`at` integer NOT NULL,
	`kind` integer NOT NULL,
	`position_ms` integer,
	CONSTRAINT `fk_play_history_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_play_history_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE SET NULL,
	CONSTRAINT "play_history_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `playlist_tracks` (
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `playlist_tracks_pk` PRIMARY KEY(`playlist_id`, `position`),
	CONSTRAINT `fk_playlist_tracks_playlist_id_playlists_id_fk` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_playlist_tracks_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`definition` text,
	`parent_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	`modified` integer NOT NULL,
	CONSTRAINT `fk_playlists_parent_id_playlists_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE,
	CONSTRAINT "playlists_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `roots` (
	`id` text PRIMARY KEY,
	`path` text NOT NULL UNIQUE,
	`include` text,
	`exclude` text,
	`slow` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_scan` integer,
	CONSTRAINT "roots_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	CONSTRAINT "settings_has_key" CHECK("key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `tag_writes` (
	`id` text PRIMARY KEY,
	`batch_id` text NOT NULL,
	`media_id` text NOT NULL,
	`field_id` integer NOT NULL,
	`old_value` text,
	`new_value` text,
	`at` integer NOT NULL,
	`applied` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_tag_writes_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE CASCADE,
	CONSTRAINT "tag_writes_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `track_extras` (
	`track_id` text NOT NULL,
	`field_id` integer NOT NULL,
	`value` text,
	CONSTRAINT `track_extras_pk` PRIMARY KEY(`track_id`, `field_id`),
	CONSTRAINT `fk_track_extras_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `track_values` (
	`track_id` text NOT NULL,
	`field_id` integer NOT NULL,
	`value_id` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `track_values_pk` PRIMARY KEY(`track_id`, `field_id`, `ordinal`),
	CONSTRAINT `fk_track_values_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_track_values_value_id_values__id_fk` FOREIGN KEY (`value_id`) REFERENCES `values_`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY,
	`title` text,
	`album_id` text,
	`year` integer,
	`track_number` integer,
	`disc_number` integer,
	`length_ms` integer,
	`compilation` integer DEFAULT 0 NOT NULL,
	`bpm` integer,
	`mb_recording_id` text,
	`acoustid` text,
	`identity_source` text DEFAULT 'heuristic' NOT NULL,
	`identity_key` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`rating` integer,
	`play_count` integer DEFAULT 0 NOT NULL,
	`skip_count` integer DEFAULT 0 NOT NULL,
	`first_played` integer,
	`last_played` integer,
	`last_skipped` integer,
	`bookmark_ms` integer,
	`loved` integer DEFAULT 0 NOT NULL,
	`rg_track_gain` real,
	`rg_album_gain` real,
	`added` integer NOT NULL,
	`modified` integer NOT NULL,
	`primary_media_id` text,
	CONSTRAINT `fk_tracks_album_id_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tracks_primary_media_id_media_id_fk` FOREIGN KEY (`primary_media_id`) REFERENCES `media`(`id`) ON DELETE SET NULL,
	CONSTRAINT "tracks_has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `values_` (
	`id` text PRIMARY KEY,
	`field_id` integer NOT NULL,
	`value` text NOT NULL,
	`sort_key` text,
	`colour` text,
	`mb_id` text,
	CONSTRAINT "values__has_key" CHECK("id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `albums_artist` ON `albums` (`album_artist_id`);--> statement-breakpoint
CREATE INDEX `albums_mbid` ON `albums` (`mb_release_id`) WHERE "albums"."mb_release_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_album` ON `artwork` (`album_id`) WHERE "artwork"."album_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_track` ON `artwork` (`track_id`) WHERE "artwork"."track_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `artwork_hash` ON `artwork` (`hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_uri_subtrack` ON `media` (`uri`,`subtrack_index`);--> statement-breakpoint
CREATE INDEX `media_track` ON `media` (`track_id`);--> statement-breakpoint
CREATE INDEX `media_hash` ON `media` (`audio_hash`) WHERE "media"."audio_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `media_present` ON `media` (`present`,`kind`);--> statement-breakpoint
CREATE INDEX `media_uri` ON `media` (`uri`);--> statement-breakpoint
CREATE INDEX `merge_journal_batch` ON `merge_journal` (`batch_id`);--> statement-breakpoint
CREATE INDEX `merge_journal_at` ON `merge_journal` (`at`);--> statement-breakpoint
CREATE INDEX `play_history_track` ON `play_history` (`track_id`,`at`);--> statement-breakpoint
CREATE INDEX `play_history_at` ON `play_history` (`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `play_history_unique` ON `play_history` (`track_id`,`at`,`kind`);--> statement-breakpoint
CREATE INDEX `tag_writes_batch` ON `tag_writes` (`batch_id`);--> statement-breakpoint
CREATE INDEX `track_values_lookup` ON `track_values` (`field_id`,`value_id`,`track_id`);--> statement-breakpoint
CREATE INDEX `tracks_album` ON `tracks` (`album_id`);--> statement-breakpoint
CREATE INDEX `tracks_identity` ON `tracks` (`identity_key`);--> statement-breakpoint
CREATE INDEX `tracks_mbid` ON `tracks` (`mb_recording_id`) WHERE "tracks"."mb_recording_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tracks_acoustid` ON `tracks` (`acoustid`) WHERE "tracks"."acoustid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `tracks_rating` ON `tracks` (`rating`);--> statement-breakpoint
CREATE INDEX `tracks_last_played` ON `tracks` (`last_played`);--> statement-breakpoint
CREATE INDEX `tracks_added` ON `tracks` (`added`);--> statement-breakpoint
CREATE UNIQUE INDEX `values_field_value` ON `values_` (`field_id`,`value`);