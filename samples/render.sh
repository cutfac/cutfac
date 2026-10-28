#!/usr/bin/env bash
# Renders each sample's preview in each language, laid out as the app copies a sample into a video's
# folder: the code, its fonts and copy.json in src/. Needs python3 with Pillow and numpy, and ffmpeg.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

for reel in "$here"/*/reel.py; do
  sample="$(dirname "$reel")"
  name="$(basename "$sample")"

  for copy in "$sample"/copy.*.json; do
    lang="$(basename "$copy" .json)"
    lang="${lang#copy.}"
    build="$(mktemp -d)"
    mkdir "$build/src"
    cp -R "$here/motion.py" "$here/fonts" "$reel" "$build/src/"
    cp "$copy" "$build/src/copy.json"
    python3 "$build/src/reel.py" "$sample/preview.$lang.mp4"
    rm -rf "$build"
    echo "$name/preview.$lang.mp4"
  done
done
