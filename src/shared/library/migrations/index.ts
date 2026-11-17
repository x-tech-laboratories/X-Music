// Written by x-libs-bundle-migrations from the migration folders beside it; run it again after drizzle-kit generate.

import type { DrizzleMigration } from "@x-tech-laboratories/x-libs/drizzle";

export const migrations: DrizzleMigration[] = [
  {
    "name": "20261117210302_start",
    "statements": [
      "CREATE TABLE `albums` (\n\t`id` text PRIMARY KEY,\n\t`match_key` text NOT NULL UNIQUE,\n\t`pinned` integer DEFAULT 0 NOT NULL,\n\t`name` text,\n\t`edition` text,\n\t`album_artist_id` text,\n\t`year` integer,\n\t`disc_total` integer,\n\t`mb_release_id` text,\n\t`mb_release_group_id` text,\n\t`is_compilation` integer DEFAULT 0 NOT NULL,\n\t`rg_album_gain` real,\n\t`added` integer NOT NULL,\n\tCONSTRAINT `fk_albums_album_artist_id_values__id_fk` FOREIGN KEY (`album_artist_id`) REFERENCES `values_`(`id`) ON DELETE SET NULL,\n\tCONSTRAINT \"albums_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `artwork` (\n\t`id` text PRIMARY KEY,\n\t`album_id` text,\n\t`track_id` text,\n\t`source` text NOT NULL,\n\t`origin` text,\n\t`hash` text,\n\t`path` text,\n\t`width` integer,\n\t`height` integer,\n\t`bytes` integer,\n\t`found_at` integer NOT NULL,\n\tCONSTRAINT `fk_artwork_album_id_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT `fk_artwork_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT \"artwork_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `media` (\n\t`id` text PRIMARY KEY,\n\t`track_id` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`uri` text NOT NULL,\n\t`provider` text,\n\t`subtrack_index` integer DEFAULT 0 NOT NULL,\n\t`start_ms` integer,\n\t`end_ms` integer,\n\t`audio_hash` blob,\n\t`audio_hash_algo` text,\n\t`codec` text,\n\t`container` text,\n\t`bitrate` integer,\n\t`bitrate_mode` text,\n\t`samplerate` integer,\n\t`channels` integer,\n\t`bits_per_sample` integer,\n\t`filesize` integer,\n\t`mtime` integer,\n\t`present` integer DEFAULT 1 NOT NULL,\n\t`last_seen` integer,\n\t`quality_rank` integer DEFAULT 0 NOT NULL,\n\t`added` integer NOT NULL,\n\tCONSTRAINT `fk_media_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT \"media_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `media_tags` (\n\t`media_id` text NOT NULL,\n\t`field_id` integer NOT NULL,\n\t`ordinal` integer DEFAULT 0 NOT NULL,\n\t`value` text,\n\tCONSTRAINT `media_tags_pk` PRIMARY KEY(`media_id`, `field_id`, `ordinal`),\n\tCONSTRAINT `fk_media_tags_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE CASCADE\n);",
      "CREATE TABLE `merge_journal` (\n\t`id` text PRIMARY KEY,\n\t`batch_id` text NOT NULL,\n\t`at` integer NOT NULL,\n\t`survivor_id` text NOT NULL,\n\t`snapshot` text NOT NULL,\n\t`undone` integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT \"merge_journal_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `play_history` (\n\t`id` text PRIMARY KEY,\n\t`track_id` text NOT NULL,\n\t`media_id` text,\n\t`at` integer NOT NULL,\n\t`kind` integer NOT NULL,\n\t`position_ms` integer,\n\tCONSTRAINT `fk_play_history_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT `fk_play_history_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE SET NULL,\n\tCONSTRAINT \"play_history_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `playlist_tracks` (\n\t`playlist_id` text NOT NULL,\n\t`track_id` text NOT NULL,\n\t`position` integer NOT NULL,\n\tCONSTRAINT `playlist_tracks_pk` PRIMARY KEY(`playlist_id`, `position`),\n\tCONSTRAINT `fk_playlist_tracks_playlist_id_playlists_id_fk` FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT `fk_playlist_tracks_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE\n);",
      "CREATE TABLE `playlists` (\n\t`id` text PRIMARY KEY,\n\t`name` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`definition` text,\n\t`parent_id` text,\n\t`position` integer DEFAULT 0 NOT NULL,\n\t`created` integer NOT NULL,\n\t`modified` integer NOT NULL,\n\tCONSTRAINT `fk_playlists_parent_id_playlists_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `playlists`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT \"playlists_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `roots` (\n\t`id` text PRIMARY KEY,\n\t`path` text NOT NULL UNIQUE,\n\t`include` text,\n\t`exclude` text,\n\t`slow` integer DEFAULT 0 NOT NULL,\n\t`enabled` integer DEFAULT 1 NOT NULL,\n\t`last_scan` integer,\n\tCONSTRAINT \"roots_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `settings` (\n\t`key` text PRIMARY KEY,\n\t`value` text NOT NULL,\n\tCONSTRAINT \"settings_has_key\" CHECK(\"key\" IS NOT NULL)\n);",
      "CREATE TABLE `tag_writes` (\n\t`id` text PRIMARY KEY,\n\t`batch_id` text NOT NULL,\n\t`media_id` text NOT NULL,\n\t`field_id` integer NOT NULL,\n\t`old_value` text,\n\t`new_value` text,\n\t`at` integer NOT NULL,\n\t`applied` integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT `fk_tag_writes_media_id_media_id_fk` FOREIGN KEY (`media_id`) REFERENCES `media`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT \"tag_writes_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `track_extras` (\n\t`track_id` text NOT NULL,\n\t`field_id` integer NOT NULL,\n\t`value` text,\n\tCONSTRAINT `track_extras_pk` PRIMARY KEY(`track_id`, `field_id`),\n\tCONSTRAINT `fk_track_extras_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE\n);",
      "CREATE TABLE `track_values` (\n\t`track_id` text NOT NULL,\n\t`field_id` integer NOT NULL,\n\t`value_id` text NOT NULL,\n\t`ordinal` integer DEFAULT 0 NOT NULL,\n\tCONSTRAINT `track_values_pk` PRIMARY KEY(`track_id`, `field_id`, `ordinal`),\n\tCONSTRAINT `fk_track_values_track_id_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE,\n\tCONSTRAINT `fk_track_values_value_id_values__id_fk` FOREIGN KEY (`value_id`) REFERENCES `values_`(`id`) ON DELETE CASCADE\n);",
      "CREATE TABLE `tracks` (\n\t`id` text PRIMARY KEY,\n\t`title` text,\n\t`album_id` text,\n\t`year` integer,\n\t`track_number` integer,\n\t`disc_number` integer,\n\t`length_ms` integer,\n\t`compilation` integer DEFAULT 0 NOT NULL,\n\t`bpm` integer,\n\t`mb_recording_id` text,\n\t`acoustid` text,\n\t`identity_source` text DEFAULT 'heuristic' NOT NULL,\n\t`identity_key` text,\n\t`pinned` integer DEFAULT 0 NOT NULL,\n\t`rating` integer,\n\t`play_count` integer DEFAULT 0 NOT NULL,\n\t`skip_count` integer DEFAULT 0 NOT NULL,\n\t`first_played` integer,\n\t`last_played` integer,\n\t`last_skipped` integer,\n\t`bookmark_ms` integer,\n\t`loved` integer DEFAULT 0 NOT NULL,\n\t`rg_track_gain` real,\n\t`rg_album_gain` real,\n\t`added` integer NOT NULL,\n\t`modified` integer NOT NULL,\n\t`primary_media_id` text,\n\tCONSTRAINT `fk_tracks_album_id_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON DELETE SET NULL,\n\tCONSTRAINT `fk_tracks_primary_media_id_media_id_fk` FOREIGN KEY (`primary_media_id`) REFERENCES `media`(`id`) ON DELETE SET NULL,\n\tCONSTRAINT \"tracks_has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE TABLE `values_` (\n\t`id` text PRIMARY KEY,\n\t`field_id` integer NOT NULL,\n\t`value` text NOT NULL,\n\t`sort_key` text,\n\t`colour` text,\n\t`mb_id` text,\n\tCONSTRAINT \"values__has_key\" CHECK(\"id\" IS NOT NULL)\n);",
      "CREATE INDEX `albums_artist` ON `albums` (`album_artist_id`);",
      "CREATE INDEX `albums_mbid` ON `albums` (`mb_release_id`) WHERE \"albums\".\"mb_release_id\" IS NOT NULL;",
      "CREATE UNIQUE INDEX `artwork_album` ON `artwork` (`album_id`) WHERE \"artwork\".\"album_id\" IS NOT NULL;",
      "CREATE UNIQUE INDEX `artwork_track` ON `artwork` (`track_id`) WHERE \"artwork\".\"track_id\" IS NOT NULL;",
      "CREATE INDEX `artwork_hash` ON `artwork` (`hash`);",
      "CREATE UNIQUE INDEX `media_uri_subtrack` ON `media` (`uri`,`subtrack_index`);",
      "CREATE INDEX `media_track` ON `media` (`track_id`);",
      "CREATE INDEX `media_hash` ON `media` (`audio_hash`) WHERE \"media\".\"audio_hash\" IS NOT NULL;",
      "CREATE INDEX `media_present` ON `media` (`present`,`kind`);",
      "CREATE INDEX `media_uri` ON `media` (`uri`);",
      "CREATE INDEX `merge_journal_batch` ON `merge_journal` (`batch_id`);",
      "CREATE INDEX `merge_journal_at` ON `merge_journal` (`at`);",
      "CREATE INDEX `play_history_track` ON `play_history` (`track_id`,`at`);",
      "CREATE INDEX `play_history_at` ON `play_history` (`at`);",
      "CREATE UNIQUE INDEX `play_history_unique` ON `play_history` (`track_id`,`at`,`kind`);",
      "CREATE INDEX `tag_writes_batch` ON `tag_writes` (`batch_id`);",
      "CREATE INDEX `track_values_lookup` ON `track_values` (`field_id`,`value_id`,`track_id`);",
      "CREATE INDEX `tracks_album` ON `tracks` (`album_id`);",
      "CREATE INDEX `tracks_identity` ON `tracks` (`identity_key`);",
      "CREATE INDEX `tracks_mbid` ON `tracks` (`mb_recording_id`) WHERE \"tracks\".\"mb_recording_id\" IS NOT NULL;",
      "CREATE INDEX `tracks_acoustid` ON `tracks` (`acoustid`) WHERE \"tracks\".\"acoustid\" IS NOT NULL;",
      "CREATE INDEX `tracks_rating` ON `tracks` (`rating`);",
      "CREATE INDEX `tracks_last_played` ON `tracks` (`last_played`);",
      "CREATE INDEX `tracks_added` ON `tracks` (`added`);",
      "CREATE UNIQUE INDEX `values_field_value` ON `values_` (`field_id`,`value`);"
    ]
  },
  {
    "name": "20261117210305_search",
    "statements": [
      "-- Full-text search over the tracks, keyed by the track's id; Drizzle has no builder for a virtual table.\nCREATE VIRTUAL TABLE `tracks_fts` USING fts5(\n\ttrack_id UNINDEXED, title, artist, album, album_artist, genre, comment, lyrics,\n\ttokenize = \"unicode61 remove_diacritics 2\"\n);"
    ]
  }
];
