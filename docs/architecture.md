# Architecture

## Principles

1. **Agent-first, naturally.** The user's agent is the main user. What it needs (the skill, the
   state of the workspace, what is broken and how to fix it) reaches it through the tools it
   already calls, without the user running setup steps or relaying messages. When the factory
   cannot do something itself, it tells the agent what to do and why, in words the agent can act
   on, and the agent asks the user only for decisions and consent.
2. **Local first.** The workspace is a folder on the user's machine and the files are the source of
   truth. Agents edit the same files directly; the server indexes on demand (no database).
3. **Bring your own agent.** Claude Code and Codex connect through the stdio MCP server and the
   bundled `content-factory` skill. The factory does deterministic work (probe, cuts, frames,
   checks). Agents do interpretation and production.
4. **Pull-based feedback.** Comments left on the board are stored in `item.yaml`. The agent reads
   them with `list_open_feedback`, or the user pastes the board's "copy agent prompt".
5. **Domain-agnostic core.** Product, formats, and renderers are workspace data; chess is one
   workspace, not part of the core.

## Components

| Path | Role |
| --- | --- |
| `src/core/` | Schemas, `Workspace` (every filesystem access, root-escape guarded), items, references, formats, verification |
| `src/mcp/` | MCP tools over the core. Transport-agnostic, stdio today |
| `src/server/` | HTTP API on Effect, `/files/*` with byte ranges, SSE change feed from `fs.watch` and agent run streams |
| `web/` | React SPA (board, item editor, references, product) |
| `electron/` | Desktop shell: starts the server as a sidecar and opens the SPA in a window |
| `skills/` | Agent skill copied into each workspace and kept current on `init`, `serve` and MCP start. A copy the user edited is left alone, and `workspace_overview` tells the agent to offer the new one |

## Editing by chat

Users do not edit video themselves. The item editor only says where and what; agents do the editing
with ffmpeg and the skill.

1. **Target.** The user selects a range on the timeline and, optionally, a box on the frame. Both
   are stored on the feedback entry in `item.yaml` (`timecode`, `end`, `region`).
2. **Context.** Before the agent starts, the core saves `before.*` (a copy of the media), `clip.mp4`
   (the range, re-encoded frame-accurately), and `frame.png` (the frame with the box drawn) under
   the item's `edits/<feedback id>/`. The prompt names these files, the timecodes, and the original,
   and lists the item's `sources`: folders, files, and http(s) links the user wants read, stored
   relative when inside the workspace and absolute outside it (`src/core/sources.ts`). Nothing is
   read when they are saved; the agent says when one is gone.
3. **Run.** `src/core/agentRun.ts` runs `claude -p` or `codex exec` headless in the workspace, one
   session per item, and streams its steps over SSE (`/api/item/run`). A request may name the model
   and effort (`claude --model --effort`, `codex -m` with `model_reasoning_effort`); left out, each
   CLI uses its own default. Claude Code may fetch from the hosts of the item's source links. Without
   an agent the request stays queued; the chat offers "Copy prompt" so any agent can pick it up.
4. **Line.** One run works on an item at a time. A request sent while the item's agent is busy, or
   while earlier requests wait, is stored with `waiting: <agent>` and runs in the order requests
   were made. Its context and `baseline` are taken when its turn begins, so its before side is the
   result of the run ahead of it. A run that finishes hands the item to the next waiting request; a
   failed or stopped run pauses the line until the user continues it or cancels the rest
   (`/api/item/edit/continue`, `/api/item/edit/cancel`). Waiting requests can be reworded
   (`/api/item/edit/reword`). The user's own agent sees `waiting` in `list_open_feedback` and leaves
   those requests to the board.
5. **Result.** When the run ends, the media as it is now is kept as `after`. The user compares
   before and after, then approves (the edit stays) or restores (`before` is copied back), or asks
   again with the same target.
6. **History.** Each item keeps `history/history.yaml`: an undo stack of media and field changes,
   the saved versions of each media file (the `before` and `after` copies, or copies under
   `history/`), and the version each file should hold. A file that no longer matches it was changed
   outside a request and becomes an entry of its own before the next undo. Undo and redo copy a
   saved version back and update the request's verdict; they wait until no agent is on the item.

## Reviewing renders

Agents judge a render by looking at it, not at the code that made it. Before rendering, the skill
has the agent write the item's `brief.md` and `shotlist.md` and get the user's okay. After
`verify_item`, `review_media` writes `review/<video>/` in the item: frames from the first to the
last, a contact sheet of them, and a six-frame strip across each detected cut, where half-finished
motion shows. The agent names the three largest defects, fixes only those, renders, and reviews
again, so each round is a small, local change. The core only renders frames; judging them is the
agent's job.

Each review also writes `review.yaml` (the video, when, which frames and strips, and what could not
be made). The item's Checks tab reads it to show the user what the agent last judged each video by,
and says so when the video changed after the review. The same tab shows whether the item's template
is ready and the checklist renders are held to.

## Templates

A template (a format in the core) is a folder with a `format.yaml` that declares what making an item
with it takes: Agent Skills, programs on `PATH`, extra agent tools, and inputs chosen per item. The
spec is in [templates.md](templates.md).

The factory has no importers. The user's agent reads a link and writes the folder; the core only
decodes it and reports what is missing (`check_format`, `/api/formats/status`), so any source that
an agent can read works without code here. Installing skills or programs is the agent's job, with
the user's consent; the core never downloads or installs anything. Edit requests point the agent at
the template's README, skills and the files of the item's chosen inputs.

The board can run that agent for the user (`src/core/imports.ts`, `src/core/importRun.ts`). An
import is a conversation stored in `.factory/imports/<id>.yaml`; each turn resumes the same agent
session, or replays the conversation when the session is gone. Consent is enforced by what the CLI
may run, not by asking the agent. Until the user presses Allow, Claude Code gets read tools only and
Codex its read-only sandbox, and the workspace's MCP write tools are off. After Allow, Claude Code
may also edit the workspace and run commands that fetch and move files, inside its sandbox and
without credentials in their environment, and Codex gets its workspace-write sandbox with network
access. In both phases Claude Code is kept from reading outside the workspace, credentials and
`.env` files (`claudeImportSettings`). Codex has no such limit: its sandboxes restrict writes and,
after Allow, nothing stops its shell from running what it fetched. Either way only the workspace's
MCP server is loaded. When a run after Allow ends, `settleInstalls` copies each new skill to the
skill folder it is missing from (`mirrorSkills`) and records the skills and formats the import added
since Allow.

## Where the UI runs

All options share one local process (API + MCP), because agents, ffmpeg, yt-dlp, and renderers
need the machine. Only the origin that serves the SPA differs:

- **Now: localhost.** `factory serve` serves the SPA and API on `localhost:4317`.
- **Later: hosted UI + local daemon.** The same SPA served from a public origin talks to the local
  daemon (`?api=http://localhost:4317`). This needs CORS for that origin, a pairing token, and
  validation of Chrome's local network access prompt and Safari's localhost policy.
- **Desktop shell.** `electron/` wraps the same server and SPA. The server runs as a sidecar
  (`factory serve --host 127.0.0.1 --web-dir <bundled web>`), compiled with `bun build --compile`
  for the packaged app, and the window loads it. The packaged app updates itself with
  electron-updater from a feed on a CDN (`latest-mac.yml` plus the signed zip), which
  `bun run release:desktop` publishes.

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

- The core is under AGPL-3.0 (`LICENSE`, declared in `package.json`). Planned: skills and
  templates under MIT, with their own LICENSE files once this is confirmed.
- Remotion needs a company license for some commercial uses and hosted rendering. Keep it an
  optional starter template, not a core dependency.
