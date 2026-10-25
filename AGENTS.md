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

Open source:

- This repository is the open-source app and will be public. Keep business information out of it:
  pricing rationale, marketing and launch plans, revenue and customer data, and notes on other
  companies. That covers files, code comments, tests, commit messages, and PR text. What
  cutfac.com already shows publicly, such as plan prices, is fine.
- Write business notes in `docs/business/`, which `.gitignore` keeps out of the repository. Tracked
  files never link to them, since the public copy won't have them.

Engineering:

- Runtime and packages: Bun only (`bun`, `bun run`). Lint with `oxlint`, format with `oxfmt`.
- Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- For core logic, look at how OpenCode does it first: its source, also Effect 4, is in
  `reference-repos/opencode/`, vendored with `git subtree --squash`. Only read it; don't edit or
  import from it. Update it with
  `git subtree pull --prefix=reference-repos/opencode https://github.com/anomalyco/opencode.git dev --squash`.
- Keep each source file under 500 lines. When one grows past that, split it by responsibility into
  cohesive modules, not at arbitrary line boundaries. Split large intermediate work, such as
  generator scripts and generated files, the same way.
- All filesystem access goes through `Workspace` in `src/core/workspace.ts`; never bypass its root guard.
- Keep `src/core` free of HTTP and MCP concerns; MCP tools and API routes are thin adapters.
- Board text doesn't select by default, as in a native app. Content people would copy (chat, guides,
  errors, paths) opts in by wrapping it in `<SelectionArea>`; see `docs/ui.md`.
- Clickable things keep the arrow cursor, as in a native app, and show that they're clickable with a
  hover tint instead. Don't add `cursor-pointer`; see `docs/ui.md`.
- Workspace files are the source of truth. Do not add a database without a demonstrated need.
- The core must stay domain-agnostic; product- or niche-specific logic belongs in a workspace.
- Add a focused `bun:test` for parsing, status mapping, verification, and persistence changes.
- Before finishing: `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run build` for web changes.
- Work directly in this checkout. Do not create git worktrees unless the user explicitly asks.
- Commits use Conventional Commits and stay atomic.
- New dependencies need a quick license, maintenance, and adoption check.
