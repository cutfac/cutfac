# AGENTS.md

Cutfac: a local-first short-form video studio with an MCP server, local API, and web board.

Product:

- First principle: natural, agent-first UX. The user's agent should get what it needs (the skill,
  workspace state, problems and how to fix them) through the tools it already calls, with no manual
  setup steps for the user. Design every feature for that first, then for people on the board.
- For people who want to make content with agents but find agent tools uncomfortable to use. It is
  not a tool for professional video editors.
- The core features are the video editor and file management. Weigh new work by how it serves them.
- The core loop: point at a specific part of a video and have the agent change it, and make several
  variations to compare and pick from. Both should feel effortless.
- Agents make the video by writing code. Assume a capable agent and give it as much autonomy as
  possible; the product's job is well-defined, sensible primitives and a fitting frame, not
  step-by-step control.

Engineering:

- Runtime and packages: Bun only (`bun`, `bun run`). Lint with `oxlint`, format with `oxfmt`.
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- All filesystem access goes through `Workspace` in `src/core/workspace.ts`; never bypass its root guard.
- Keep `src/core` free of HTTP and MCP concerns; MCP tools and API routes are thin adapters.
- Workspace files are the source of truth. Do not add a database without a demonstrated need.
- The core must stay domain-agnostic; product- or niche-specific logic belongs in a workspace.
- Add a focused `bun:test` for parsing, status mapping, verification, and persistence changes.
- Before finishing: `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run build` for web changes.
- Commits use Conventional Commits and stay atomic.
- New dependencies need a quick license, maintenance, and adoption check.
