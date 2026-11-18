#!/usr/bin/env bash
# Launches the built app on a scratch database and profile folder; --real-library or X_MUSIC_REAL_LIBRARY=1 opens your own.
#
# VSCode's integrated terminal exports ELECTRON_RUN_AS_NODE, which makes the Electron binary run as
# bare node and die on the ESM entry point. Clear it before doing anything else.
set -euo pipefail
unset ELECTRON_RUN_AS_NODE

cd "$(dirname "$0")/.."

real_library="${X_MUSIC_REAL_LIBRARY:-0}"
args=()
for arg in "$@"; do
  if [[ "$arg" == "--real-library" ]]; then real_library=1; else args+=("$arg"); fi
done

if [[ "$real_library" == "1" ]]; then
  echo "x-music: using your real library and profile"
else
  # X_MUSIC_SCRATCH keeps one scratch folder across runs; otherwise each run gets a new one.
  X_MUSIC_SCRATCH="${X_MUSIC_SCRATCH:-$(mktemp -d -t x-music-scratch.XXXXXX)}"
  mkdir -p "$X_MUSIC_SCRATCH/profile"
  : "${X_MUSIC_DB:=$X_MUSIC_SCRATCH/library.db}"
  export X_MUSIC_DB
  args=("--user-data-dir=$X_MUSIC_SCRATCH/profile" ${args[@]+"${args[@]}"})
  echo "x-music: scratch folder $X_MUSIC_SCRATCH"
  echo "x-music: database $X_MUSIC_DB"
fi

# The app runs outside the dev shell, so point it at an mpv if one is not on PATH.
if [[ -z "${X_MUSIC_MPV:-}" ]]; then
  X_MUSIC_MPV=$(command -v mpv || ls -d /nix/store/*-mpv-0.*/bin/mpv 2>/dev/null | head -1 || true)
  export X_MUSIC_MPV
fi
[[ -n "${X_MUSIC_MPV:-}" ]] && echo "x-music: mpv $X_MUSIC_MPV"

ELECTRON="${ELECTRON_EXEC:-$(command -v electron || true)}"
if [[ -z "$ELECTRON" ]]; then
  ELECTRON=$(ls -d /nix/store/*-electron-43.*/bin/electron 2>/dev/null | head -1)
fi
[[ -n "$ELECTRON" ]] || { echo "no electron found; run inside 'nix develop'" >&2; exit 1; }

[[ -f out/main/index.js ]] || npx electron-vite build

echo "x-music: $ELECTRON"
exec "$ELECTRON" . --no-sandbox ${args[@]+"${args[@]}"}
