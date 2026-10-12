# Architecture

## Principles

1. **Local first.** The workspace is a folder on the user's machine and the files are the source of
   truth. Agents edit the same files directly; the server indexes on demand (no database).
2. **Bring your own agent.** Claude Code and Codex connect through the stdio MCP server and the
   bundled `content-factory` skill. The factory does deterministic work (probe, cuts, frames,
   checks). Agents do interpretation and production.
3. **Pull-based feedback.** Comments left on the board are stored in `item.yaml`. The agent reads
   them with `list_open_feedback`, or the user pastes the board's "copy agent prompt".
4. **Domain-agnostic core.** Product, formats, and renderers are workspace data; chess is one
   workspace, not part of the core.

## Components

| Path | Role |
| --- | --- |
| `src/core/` | Schemas, `Workspace` (every filesystem access, root-escape guarded), items, references, formats, verification |
| `src/mcp/` | MCP tools over the core. Transport-agnostic, stdio today |
| `src/server/` | HTTP API on Effect, `/files/*` with byte ranges, SSE change feed from `fs.watch` and agent run streams |
| `web/` | React SPA (board, item editor, references, calendar, product) |
| `electron/` | Desktop shell: starts the server as a sidecar and opens the SPA in a window |
| `skills/` | Agent skill installed into each workspace by `factory init` |

## Editing by chat

Users do not edit video themselves. The item editor only says where and what; agents do the editing
with ffmpeg and the skill.

1. **Target.** The user selects a range on the timeline and, optionally, a box on the frame. Both
   are stored on the feedback entry in `item.yaml` (`timecode`, `end`, `region`).
2. **Context.** Before the agent starts, the core saves `before.*` (a copy of the media), `clip.mp4`
   (the range, re-encoded frame-accurately), and `frame.png` (the frame with the box drawn) under
   the item's `edits/<feedback id>/`. The prompt names these files, the timecodes, and the original.
3. **Run.** `src/core/agentRun.ts` runs `claude -p` or `codex exec` headless in the workspace, one
   session per item, and streams its steps over SSE (`/api/item/run`). A missing or busy agent
   leaves the request queued; the chat offers "Copy prompt" so any agent can pick it up.
4. **Result.** When the run ends, the media as it is now is kept as `after`. The user compares
   before and after, then approves (the edit stays) or restores (`before` is copied back), or asks
   again with the same target.

## Where the UI runs

All options share one local process (API + MCP), because agents, ffmpeg, yt-dlp, and renderers
need the machine. Only the origin that serves the SPA differs:

- **Now: localhost.** `factory serve` serves the SPA and API on `localhost:4317`.
- **Later: hosted UI + local daemon.** The same SPA served from a public origin talks to the local
  daemon (`?api=http://localhost:4317`). This needs CORS for that origin, a pairing token, and
  validation of Chrome's local network access prompt and Safari's localhost policy.
- **Desktop shell.** `electron/` wraps the same server and SPA. The server runs as a sidecar
  (`factory serve --host 127.0.0.1 --web-dir <bundled web>`), compiled with `bun build --compile`
  for the packaged app, and the window loads it.

A pure in-browser version (File System Access API, ffmpeg.wasm) is out of scope: agents cannot
reach a browser tab, which breaks bring-your-own-agent.

## Open source and paid add-ons

The core stays fully usable offline and for free. Paid features are services that need a server,
so they cannot be bypassed and do not lock local data:

- Managed publishing and metrics collection using our platform API approvals (TikTok Content
  Posting API audit, Meta app review), with quotas as the free tier.
- Phone review links through a relay.
- Cloud render bursts, backup and sync, and team reviewers.

Mechanics: `factory login` (device-code flow) stores a token locally; the daemon attaches it only
to cloud calls; entitlements are always checked server-side; the SPA reads entitlements from the
daemon to show upgrade prompts. Use a merchant of record (Polar or Lemon Squeezy) for billing.
For hosted execution, use per-job isolated runners (for example Firecracker microVMs) with the
agent staying on the user's machine and connecting through remote MCP.

## Licensing notes

- Planned: core under AGPL-3.0 (declared in `package.json`), skills and templates under MIT. The
  LICENSE files are added once this is confirmed.
- Remotion needs a company license for some commercial uses and hosted rendering. Keep it an
  optional starter template, not a core dependency.
