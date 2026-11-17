{ pkgs ? import <nixpkgs> { } }:

let
  # Pinned so the better-sqlite3 native build and the runtime agree on one ABI.
  electron = pkgs.electron_43;

  # Shared libraries the Electron binary and the better-sqlite3 prebuild load at runtime.
  runtime_libs = with pkgs; [
    glib nss nspr at-spi2-atk at-spi2-core cups dbus libdrm expat
    libxkbcommon mesa alsa-lib pango cairo gtk3 gdk-pixbuf
    libx11 libxcomposite libxdamage libxext libxfixes libxrandr libxcb
    stdenv.cc.cc.lib
  ];
in
pkgs.mkShell {
  packages = with pkgs; [
    nodejs_24
    electron
    mpv # Plays the music.
    sqlite # The sqlite3 command for looking inside the library database.
    python3 # node-gyp needs it to build native modules.
    pkg-config
    gcc
    gnumake
    git
  ] ++ runtime_libs;

  shellHook = ''
    # VSCode's terminal exports this, which makes Electron run as bare node and die on the ESM main.
    unset ELECTRON_RUN_AS_NODE

    # The npm-downloaded Electron cannot run on NixOS, so the nixpkgs one is used.
    export ELECTRON_SKIP_BINARY_DOWNLOAD=1
    export ELECTRON_OVERRIDE_DIST_PATH="${electron}/libexec/electron"
    export ELECTRON_EXEC="${electron}/bin/electron"

    # node-gyp builds better-sqlite3 against Electron's headers, not Node's.
    export npm_config_runtime=electron
    export npm_config_target="${electron.version}"
    export npm_config_disturl=https://electronjs.org/headers
    export npm_config_build_from_source=true

    export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath runtime_libs}:$LD_LIBRARY_PATH"

    echo "x-music dev shell · node $(node -v) · electron ${electron.version} · mpv $(mpv --version | head -1 | cut -d' ' -f2)"
  '';
}
