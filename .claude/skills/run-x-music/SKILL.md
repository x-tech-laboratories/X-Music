---
name: run-x-music
description: Build, launch and drive the X-Music desktop app, take screenshots of its window, and read its UI. Use when asked to run X-Music, screenshot it, or confirm a change works in the real app rather than in tests.
---

X-Music is an Electron app. Launch it with a DevTools port open, then drive it with
`.claude/skills/run-x-music/driver.mjs`, which talks CDP over Node's global `WebSocket`. There is no
Playwright in this project and none is needed.

## Build

```sh
unset ELECTRON_RUN_AS_NODE
npm run build            # typecheck + electron-vite build
```

## Launch

```sh
SP=<scratchpad>
unset ELECTRON_RUN_AS_NODE
X_MUSIC_SCRATCH=$SP/x-music X_MUSIC_LOG=info X_MUSIC_LOG_FILE=$SP/x-music.log \
  nohup bash scripts/run.sh --remote-debugging-port=9222 > $SP/launch.out 2>&1 &
sleep 8
grep -i "devtools listening" $SP/launch.out
```

`scripts/run.sh` finds mpv and Electron, and builds first if `out/` is missing. It always runs on a
scratch database and scratch profile folder (`--user-data-dir`) under `X_MUSIC_SCRATCH`, a new temp
folder when that is unset, so the real library in `~/.config/x-music` is never opened. Only
`--real-library` or `X_MUSIC_REAL_LIBRARY=1` opens the real one; never pass either from a check.

## Drive

```sh
node .claude/skills/run-x-music/driver.mjs eval "document.body.innerText.slice(0,500)"
node .claude/skills/run-x-music/driver.mjs shot $SP/01-landing.png
node .claude/skills/run-x-music/driver.mjs text .statusbar
node .claude/skills/run-x-music/driver.mjs menu 0     # context menu on the first song row
```

`eval` runs in the renderer and prints the JSON result, awaiting promises. The IPC surface is on
`window.xMusic` keyed by call name (the same calls the MCP server offers), so the app can be driven below the UI:

```sh
node .../driver.mjs eval "(async()=>JSON.stringify(await window.xMusic.list_folders()))()"
node .../driver.mjs eval "(async()=>JSON.stringify(await window.xMusic.get_library_stats()))()"
```

Long jobs are best started detached and polled, because a scan takes over a minute:

```sh
node .../driver.mjs eval "window.__scan=window.xMusic.scan_folders().then(r=>window.__done=r); 'started'"
node .../driver.mjs eval "JSON.stringify(window.__done??null)"
```

## Gotchas

- **`ELECTRON_RUN_AS_NODE` must be unset.** VSCode's terminal exports it, which makes Electron run
  as bare node and die on the ESM entry point. `scripts/run.sh` clears it, but clear it in the shell
  too so `npm run build` behaves.
- **Each `eval` shares one global scope.** `const r = ...` twice in a session throws "Identifier 'r'
  has already been declared". Wrap every snippet in `(()=>{ ... })()`.
- **The context menu needs two separate calls.** Dispatching `contextmenu` and reading
  `[role=menuitem]` in the same `eval` finds nothing; the menu is gone by the time a third call runs.
  Open it in one call, click the item in the next.
- **`window.xMusicPage.pick_folder` opens a native folder picker**, which blocks the main process
  forever with no way to dismiss it from CDP. Do not call it; add a folder by path with
  `window.xMusic.add_folder('<dir>')` instead.
- **mpv inherits the DevTools listening socket.** Killing X-Music leaves an orphaned `mpv --idle`
  holding port 9222, and the next launch logs "Cannot start http server for devtools" and exposes no
  page target. Check with `ss -ltnp | grep 9222` and kill that mpv by pid — never `pkill -x mpv`,
  which also kills the user's own players.
- **Kill the parent, not the children.** The parent's command line is
  `electron --no-sandbox --remote-debugging-port=9222 .`; the `--type=` children carry
  `--user-data-dir=`, so a pattern matching only the latter leaves the parent running and the port
  bound. A parent blocked in a native dialog ignores SIGTERM and needs SIGKILL.
- **Screenshots are the renderer only**, at whatever the window size is. Content wider than the
  window is clipped, not scaled.
