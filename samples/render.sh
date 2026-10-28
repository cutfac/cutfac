#!/usr/bin/env bash
# Renders each sample's preview in each language, laid out as the app copies a sample into a video's
# folder: its page, the shared code, its fonts and copy.json in src/. Needs Playwright installed here
# (`bun install`, then `bunx playwright install chromium`), Node, and ffmpeg.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

for page in "$here"/*/index.html; do
  sample="$(dirname "$page")"
  name="$(basename "$sample")"

  for copy in "$sample"/copy.*.json; do
    lang="$(basename "$copy" .json)"
    lang="${lang#copy.}"
    build="$(mktemp -d)"
    mkdir "$build/src"
    cp "$here/motion.js" "$here/render.mjs" "$here/package.json" "$page" "$build/src/"
    cp -R "$here/fonts" "$build/src/"
    cp "$copy" "$build/src/copy.json"
    ln -s "$here/node_modules" "$build/src/node_modules"
    node "$build/src/render.mjs" "$sample/preview.$lang.mp4" 2>&1 | grep -v '^Rendered' || true
    rm -rf "$build"
  done
done
