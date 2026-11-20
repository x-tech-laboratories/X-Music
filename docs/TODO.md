# X-Music to-do

## Known bugs

- The artist text is clipped at its left edge in the filter pane and the song list (an artist "Example Quartet" reads "xample Quartet", "Example Trio" reads "t Trio"), as if the column scrolled sideways. Seen 2026-11-14 on a library of 11 synthetic tracks at an app window of 1377 by 862. Find why the cell scrolls, fix it, and add a test.

## Website

- Once the clipped artists are fixed, retake the X-Music screenshot on the Projects page of x-tech-laboratories.github.io (`public/screenshots/x-music.png`, linked from `src/content/docs/projects.mdx`). It currently shows the clipped names.

## Standards work, still open

Left over from bringing X-Music up to the Application Standard and Design Guidelines in November 2026.

- Move Electron from 43 to 45, the current major, as the Application Standard asks.
- Take Noto Sans from Halon once Halon ships the font files, so the app no longer falls back to a system font.
- Design spec: remove the clause about reconsidering Rust and Tauri, and replace the Python (mutagen) fallback for tag writing with one on the current stack, TypeScript and Node.
- Design spec: decide whether widgets keep CSS Modules for their layout. The spec keeps them for layout only; Halon may be able to carry what is left in `app.css`, `PlayerBlock.module.css` and `SongProperties.module.css`.
- Clear library: keep the track history and the merge journal unless asked. Give the confirm dialog two separate options, one to also clear the track history and one to also clear the merge journal, and give the `clear_library` call the same two. The backup is still taken first.
- Scan a real music folder into a scratch database with the current build and record the time taken, the tracks found, the files that could not be read and what the duplicate finder reports. Every run so far used generated tracks.
- Check X-Music against the Application Standard's sections on the local daemon in `src/server`, which were added after the assessment. The desktop-only deviation in the README covers the platforms, not the daemon.
- Decide whether the `// ====` section banners and the file overviews longer than one line stay. The assessment counted them against the comment rules; X-Tasks uses the same banners.
- Decide whether the three live-library tests stay. They read the owner's own library and are skipped everywhere else.
- A filter limit by total playing time or file size is in the old filter format and was never built. Old definitions keep the field untouched.
- When the surviving track of a merge is itself merged away later, undoing the earlier merge leaves the plays it moved with the later survivor.

## Needs X-Libs or Halon first

- `FacetPane` does not measure its own rows, so `FilterPane` passes a row height with a 28 px fallback.
- `DataTable` gives no rows-per-page for the Page keys, so `SongList` measures a drawn row.
- The `Failure` widget formats errors with `describe_error`, the rest of the app with `describe_call_error`.
- `Tabs` renders a `<nav>`, which adds a navigation landmark inside the page.
- Halon has no single-line text helper and no wrap-anywhere class for text that is not a path.
- Halon has no size rule for `h3`, so a level 3 `Section` title is drawn larger than a level 2 one.
- A shared History page and a "what changed between two snapshots" helper: X-Media-Tracker, X-Tasks and X-Music each build their own.
