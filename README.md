# X-Music

[![AI readiness](https://img.shields.io/endpoint?url=https://x-tech-laboratories.github.io/badges/x-tech-laboratories/X-Music.json)](https://x-tech-laboratories.github.io/guidelines/readiness/)

<a href="https://liberapay.com/BeatLink/donate"><img alt="Donate using Liberapay" src="https://liberapay.com/assets/widgets/donate.svg"></a> <a href="https://ko-fi.com/I4V52ANK6N"><img alt="Support me on Ko-fi" src="https://ko-fi.com/img/githubbutton_sm.svg"></a>

A desktop music player with gmusicbrowser's data model and power, drawn with the shared X-Libs widgets
(`@x-tech-laboratories/x-libs`) and styled by Halon (`@x-tech-laboratories/halon`), the theme every X-app
shares, with its light, dark and density choices.

The design is specified in full in [DESIGN-SPEC.md](docs/DESIGN-SPEC.md); where it disagrees with the
X-Tech [Application Standard](https://x-tech-laboratories.github.io/standards/application/) or
[Design Guidelines](https://x-tech-laboratories.github.io/standards/design/), the standards win. This README
covers only how to run what exists.

## Status

Early. The library core, query engine, playback and testing harness are real; tag writing is not
implemented yet. See the roadmap in DESIGN-SPEC §15.

| Area | State |
|---|---|
| Library store on X-Libs' `sql` and Drizzle, with ids any device can make | working |
| Upgrade of libraries from before the Drizzle store, backed up first | working |
| Identity resolution (idempotent import and scan) | working |
| Filesystem scanner (read-only, move detection) | working |
| gmusicbrowser import | working |
| Filter AST → SQL and → native predicate, on X-Libs `filter` | working, agreement property-tested in X-Libs |
| Audio content hashing (move/rename detection) | working |
| Field descriptor system | working |
| Format-string engine | working |
| View state (selection, sort, virtualization, on X-Libs) | working |
| Halon styling, with light, dark and three densities | working |
| Renderer shell (React on the X-Libs widgets and Halon) | working |
| Rearranging the window and rebinding keys, on X-Libs' plugin host and settings | planned (DESIGN-SPEC §5) |
| Playback (mpv, queue, repeat/shuffle, play counting) | working |
| MPRIS, media keys, crossfade | not started |
| Tag writing | not started |
| Filesystem watching | not started |
| Merge tracks, with per-field resolution and undo | working |
| Track history (every change a version, any version restorable, on X-Libs) | working, on the History page |
| Duplicate detection (hash, MBID, tags, fuzzy) | working |
| Song properties (identity, sources, raw tags, history) | working |
| Setting ratings (stars in the list, the player and the selection bar; keys 0–5 on picked rows) | working |
| Album art (embedded, folder image, cached) | working |
| Daily backups of the library database, on X-Libs | working |
| Picard hand-off for tagging: the picked tracks open in Picard, and their files are read again when it closes | working |
| Local MCP server for AI clients, every call described in an `api_spec` | working |

## Deviations

Where X-Music departs from the [Application Standard](https://x-tech-laboratories.github.io/standards/application/),
and the limit that forces it:

- **Desktop only.** The standard makes the web app the primary target. X-Music is an Electron app with no
  server, web page or phone build, because it plays music through mpv on the computer it runs on and reads
  the music files from that computer's disks, which neither a browser page nor a phone app can do. With no
  server, nothing syncs between devices.
- **Desktop scripts.** With no server or web page there is nothing for `dev:server`, `dev:web` or `start` to
  run, so X-Music has none of them; `build` runs `build:desktop`, and `start:desktop` runs the built app.

What follows from being desktop-only, and is not a further deviation: with no server there are no accounts
to sign in to, no HTTP API or OpenAPI document (other programs use the [MCP server](#mcp-server) instead),
and no sync. X-Music has no theming of its own; it is styled by Halon, with the theme and density chosen
under Settings → Appearance. Rearranging the window and rebinding keys are planned on X-Libs' plugin host
and settings, not on layout or keymap files of X-Music's own; none of it is built yet, and X-Music has no
plugins yet either.

## The one idea worth knowing

**A track is a piece of music, not a file.** It survives renames, moves, format changes, retagging,
and having no file at all. Anything that can render it — a local file, a second copy in another
format, a CUE range inside a larger file, a streaming URI — is a `media` row hanging off it.

Files are identified by an **audio content hash** computed over the audio stream with metadata
excluded, so retagging never changes a file's identity and a moved file is still recognisably the
same file. AcoustID answers a different question (*is this the same recording?*) and is a hint on
the track, never a key.

## Development

The Nix flake pins everything, including Electron. `nix-shell` gives the same shell as `nix develop`,
and `nix build` builds the app. SQLite is Node's own `node:sqlite`, so nothing is rebuilt for Electron.

```sh
nix develop
npm install
npm run dev
```

The shell hook clears `ELECTRON_RUN_AS_NODE`, which VSCode's integrated terminal exports and which
otherwise makes Electron run as bare node and die on the ESM entry point.

### Commands

| Command | Does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` | Same as `build:desktop` |
| `npm run build:desktop` | Typecheck and build to `out/` |
| `npm run start:desktop` | Run the built app |
| `npm test` | Full suite |
| `npm run coverage` | Full suite with a coverage report; the floor in `vitest.config.ts` only rises, so commit the numbers it rewrites |
| `npm run check` | Typecheck, then the full suite |
| `npm run test:watch` | Watch mode |
| `npm run bench` | Performance budget benchmarks |
| `npm run typecheck` | `tsc -b` for main/preload, for the page and for the tests |
| `npm run lint` | `oxlint` |
| `npm run icons` | Generate `resources/icon.png` from `resources/icon.svg` |
| `npm run app` | Build if needed and launch, on a scratch library unless asked for the real one |
| `npm run upgrade:dry-run -- <library.db>` | Try the upgrade of an older library on a copy and report on it |
| `npm run db:generate` | Write a migration for a change to `src/shared/library/schema.ts` and bundle the migrations |

Benchmarks default to 50k synthetic tracks (the §12 target); `X_MUSIC_BENCH_SIZE=20000 npm run bench`
for a quicker pass. `npm run app` runs on a scratch database and profile folder unless given `--real-library` or
`X_MUSIC_REAL_LIBRARY=1`; `X_MUSIC_DB` names the database file, and `X_MUSIC_MPV` the mpv to play with when none is on `PATH`.

### Logging

Configured entirely by environment, so detail can be turned on without a rebuild.

```sh
X_MUSIC_LOG=debug npm run app              # everything
X_MUSIC_LOG=warn,play:debug npm run app    # quiet, except playback
X_MUSIC_LOG_FILE=/tmp/x-music.log npm run app
```

Levels are `critical`, `error`, `warn`, `info` (default) and `debug`; `crit`, `warning`, `err`, `verbose`
and `trace` are accepted as aliases. A scope can be raised or lowered on its own with
`scope:level`, and `*:level` sets the default. Scopes in use: `app`, `play`, and `page.*` for anything
originating in the renderer (`page.renderer`, `page.songlist`); `page:debug` turns all of those up.

**Renderer records go to the same stream**, forwarded to the main process through X-Libs' page log, so
a UI failure is visible from the terminal rather than trapped in a devtools console nobody has open.
Uncaught errors and unhandled rejections are reported automatically.

A malformed `X_MUSIC_LOG` falls back to the default rather than silencing logging.

### Getting your library in

The Import view, a row of the sidebar, reads a gmusicbrowser `gmbrc`, defaulting to the standard location for your
platform. It imports ratings, play counts, skip counts, full play history, genres, groupings,
labels and saved lists. A preview parses the file without writing anything, so you see the counts
first.

The Folders view adds music directories and scans them. Scanning reads tags only; it never
overwrites X-Music's own ratings or play counts, recognises moved and renamed files by audio content,
and flags files that have disappeared rather than deleting their tracks.

Both are idempotent. Running either twice, or both in either order, will not duplicate anything.

### Backups

The library database, `library.db` in X-Music's profile folder (`~/.config/x-music` on Linux), is
backed up once a day into `backups` beside it, keeping the last 14. Settings → Backups backs up by
hand, changes that, and restores a backup: the current database is backed up first, and X-Music
restarts to take the restored one in. A backup is also taken before anything replaces the data: before
the database's schema is upgraded, and before Clear library empties it. Only the database is backed
up; your music files are never copied or touched. A database moved elsewhere with `X_MUSIC_DB` is
backed up beside it.

A library made by an older X-Music opens as it always did: it is backed up first, then converted in
place to the current tables, every track, file, rating, play, playlist and merge kept, each with a new
id. The conversion is all or nothing, so a library it cannot convert whole is left as it was.

To try the conversion first, run `npm run upgrade:dry-run -- ~/.config/x-music/library.db`. It copies the
library (and its write-ahead log) into a scratch folder, upgrades only the copy, and prints the time
taken, the file size and the rows in each table before and after, any references it emptied, any
merge whose undo would have reached a row that later took its number, and the integrity and
foreign-key checks. The library it is given is only read. Close X-Music before running it.

### History

Every change to a track is kept as a version, through X-Libs' history: a scan that retags it, an
import, a merge (the survivor edited, the others deleted) and an undo. Any version can be restored,
and a track a merge took away can be brought back with its files. Plays are counted, not edited, so
they make no version and a restore leaves the counts as they are. Versions are kept for a year by
default, each track keeping its newest; how long is set under Settings, Data, History. The page reaches
them through `window.xMusicHistory`.

The History page, a row of the sidebar at `#/history`, lists the latest track changes and merges
together, newest first, each version saying field by field what it changed. History on a row, or the
History button of a track's properties, opens that track's versions, and any earlier one can be
restored; a track a merge took out can be brought back. A merge not yet undone has Undo merge, which
puts every track back exactly, plays and playlist places included, from the merge's own record.

Playlists have no history of their own yet: X-Music does not edit them, they only arrive from a
gmusicbrowser import, and a merge's changes to them come back with Undo this merge. They gain one when
they become editable. X-Music has no server, so nothing syncs between devices.

## MCP server

X-Music has no server, so other programs reach it through its own MCP server on this computer. It is off
until **Settings → MCP server** turns it on; it then listens on `http://127.0.0.1:3919/mcp` (the port is set
there too), refuses any request whose Host or Origin is not this computer, and shows the command that adds it
to Claude Code:

```sh
claude mcp add --transport http x-music http://127.0.0.1:3919/mcp
```

Every call the window makes on the library and the player is a tool, described once in
`src/shared/api.ts`. The calls that only read are marked read-only, so a client may run them without asking:
`get_app_info`, `get_library_stats`, `list_tracks`, `list_track_groups`, `get_track`, `list_duplicates`,
`get_merge_preview`, `list_folders`, `get_default_gmbrc_path`, `get_gmbrc_preview`, `get_player_status`,
`list_versions`, `list_recent_versions`, `list_recent_merges` and `get_history_keep_days`. Every other tool changes something and
is marked so, and a client asks before running it: `set_rating`, `add_folder`, `remove_folder`, `scan_folders`,
`cancel_scan`, `import_gmbrc`, `merge_tracks`, `undo_merge`, `restore_version`, `set_history_keep_days`,
`clear_library` and the player's `play_track`, `toggle_playback`, `play_next`, `play_previous`,
`stop_playback`, `seek`, `set_volume`, `queue_tracks`, `remove_from_queue`, `move_in_queue`, `clear_queue`, `set_repeat` and
`set_shuffle`.
Of those, the ones that delete or overwrite data are marked destructive as well: `clear_library`,
`merge_tracks`, `undo_merge`, `restore_version`, `import_gmbrc` (it replaces ratings and plays with
gmusicbrowser's) and `set_history_keep_days` (a shorter time deletes older versions for good).

The tools that remove or replace data can be undone as they are in the window: `clear_library` backs the
library up first and is refused if that fails, `undo_merge` puts a merge back, and every change to a track,
`restore_version` included, is a version in the history. A change made through MCP shows in the open window
at once. Lengths are in milliseconds, ratings and the volume 0 to 100, dates Unix milliseconds, and ids are opaque
strings from the `list_` and `get_` tools. The dialogs, the file manager and the window's log are not
offered, and neither are the backup calls: a restore replaces the whole library and restarts X-Music, so
backups are made, restored and scheduled only from Settings.

## Testing

The suite is described in DESIGN-SPEC §13. The load-bearing one:

**`tests/filter_compile.test.ts`** runs filters over a generated library through X-Music's catalogue
and checks the SQL against the in-memory predicate; X-Libs' own property test holds the two together
for any generated filter. A missing value fails a test and negation flips that, so a negated filter
keeps tracks with no value.

Tests reach SQLite through Node's built-in `node:sqlite`, as the app does, and open the library
through the same store code. `tests/library_upgrade.test.ts` builds a library at the old schema
with a row of every kind and checks that the upgrade keeps all of it.

## Layout

```
src/
├── main/        Electron main: opens the database, scanner, artwork, playback, backups, IPC, MCP server
├── preload/     The typed IPC bridge, exposing only the declared contract
├── web/         UI: views, widgets, stores and layout CSS. Deliberately thin — see below.
└── shared/      Imported by BOTH sides: field descriptors, filter AST, format strings, view state,
                 the IPC contract and api_spec, the gmusicbrowser importer in import/, and the
                 library store (Drizzle schema, migrations, query compiler, history) in library/
tests/           One *.test.ts or *.test.tsx per behaviour
bench/           Performance budget benchmarks
docs/            The design spec and the to-do list
nix/             The Nix package; flake.nix and shell.nix sit at the top
scripts/         run.sh behind npm run app, and the upgrade dry run
resources/       icon.svg and the icons made from it
```

`shared/` is where the leverage is. The field descriptors and their filter catalogue are plain
TypeScript with no framework primitives and no DOM access; the filter AST and stack, format strings,
selection, sorting, table, panes, prefs and logging come from X-Libs, and so does the mpv engine the
main process plays through. Replacing the UI framework touches
`web/` only. The library store in `shared/library/` runs on X-Libs' `SqlDatabase`
and imports nothing from Node, so the main process only opens the file and hands it over.

## Contributing

X-Music is an [X-Tech Laboratories](https://x-tech-laboratories.github.io) project, and AI-assisted
contributions are welcome. Read [AGENTS.md](AGENTS.md) and the
[AI policy](https://github.com/x-tech-laboratories/.github/blob/main/AI_POLICY.md), and say in your
pull request how AI was involved.

## Licence

X-Music is free software, licensed under the [GNU General Public License](LICENSE), version 3 or (at
your option) any later version.
