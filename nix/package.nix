{
  lib,
  stdenv,
  buildNpmPackage,
  importNpmLock,
  nodejs_24,
  electron_43,
  mpv,
  makeWrapper,
  copyDesktopItems,
  autoPatchelfHook,
  makeDesktopItem,
}:

buildNpmPackage {
  pname = "x-music";
  version = (lib.importJSON ../package.json).version;
  src = lib.cleanSource ../.;

  nodejs = nodejs_24;
  # Read from package-lock.json, so there is no deps hash to keep in step with it.
  npmDeps = importNpmLock { npmRoot = ../.; };
  npmConfigHook = importNpmLock.npmConfigHook;
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
    autoPatchelfHook
  ];
  buildInputs = [ stdenv.cc.cc.lib ];

  # Install scripts stay off: no dependency is built natively.
  npmRebuildFlags = [ "--ignore-scripts" ];

  npmBuildScript = "build:desktop";

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --ignore-scripts
    mkdir -p $out/lib/x-music
    cp -r out resources package.json node_modules $out/lib/x-music/
    install -Dm644 resources/icon.svg $out/share/icons/hicolor/scalable/apps/x-music.svg
    install -Dm644 resources/icon.png $out/share/icons/hicolor/512x512/apps/x-music.png
    makeWrapper ${lib.getExe electron_43} $out/bin/x-music \
      --add-flags $out/lib/x-music \
      --prefix PATH : ${lib.makeBinPath [ mpv ]} \
      --unset ELECTRON_RUN_AS_NODE

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "x-music";
      desktopName = "X-Music";
      comment = "Music player";
      exec = "x-music %U";
      icon = "x-music";
      categories = [ "Audio" "AudioVideo" "Player" ];
    })
  ];

  meta = {
    description = "A desktop music player with a real library engine";
    license = lib.licenses.gpl3Plus;
    mainProgram = "x-music";
  };
}
