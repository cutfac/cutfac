# Content Factory

A local-first content factory for short-form marketing (TikTok, Reels, Shorts), built for solo
developers who market their own app. Bring your own agent: Claude Code or Codex does the work
through MCP, and you review everything on a local web board.

- **References**: drop a video or paste a URL. The factory extracts scene cuts, hook frames, a
  contact sheet, and audio, and your agent writes the analysis.
- **Formats**: reusable recipes distilled from references (hook rules, beats, duration, checks,
  optional render template).
- **Items**: one publishable post per folder, `[9x16]`-prefixed media, status from `idea` to
  `published`, with timecoded review feedback, upload checks, schedule, and metrics.
- **Product**: your app's positioning, CTA rules, and reviewed captures. Every agent run reads it.

Everything is plain folders and YAML on your machine. Nothing is uploaded.

## Requirements

Bun 1.3+, ffmpeg/ffprobe. Optional: `yt-dlp` (URL references), `whisper` (transcripts).

## Quick start

```sh
bun install && bun run build
bun src/cli.ts init ~/my-app-content --from https://yourapp.com
bun src/cli.ts serve --workspace ~/my-app-content       # http://localhost:4317
```

`init` connects your agents first, then fills the product. Claude Code gets a project-scoped
`.mcp.json` in the workspace, and Codex is registered through `codex mcp add` as
`content-factory-<workspace>`. `--from` accepts an App Store, Google Play, or landing page URL; store
links on a landing page are followed, and store screenshots land in `product/store/`. Without
`--from`, the web UI opens on a Setup page with the same two steps. Use `--no-connect` to only print
the agent commands, and `factory product import <url>` to refresh the product later. To adopt an existing folder of posts,
add a `factory.yaml` with `paths.items` pointing at it. Folders containing `POSTING.md` or
`STATUS.md` appear on the board, and an `item.yaml` is written on their first edit.

## Workspace layout

```
factory.yaml            name, timezone, platforms, paths
product/product.yaml    positioning, audience, stores, CTA, brand, rules
product/captures/       reviewed app screenshots and recordings
product/store/          imported store icon, screenshots, and listing.md
references/<id>/        source video, frames/, contact.jpg, audio.wav, preprocess.json, analysis.md
formats/<id>/           format.yaml, optional template/ and README.md
items/<id>/             item.yaml, [9x16] video.mp4, [9x16] cover.jpg, …
```

## Development

```sh
bun run serve -- --workspace <dir>   # API on :4317
bun run dev:web                      # Vite on :5173, proxies /api and /files
bun test && bun run typecheck && bun run lint
```

See [docs/architecture.md](docs/architecture.md) for the design and the hosted roadmap.
