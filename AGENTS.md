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
- Write everything that runs outside the browser in Effect 4: the core, the server, the MCP tools
  and Electron's main process. Then what can fail or be missing is in the types, and every
  dependency can be swapped in a test. Follow `node_modules/effect/CLAUDE.md` and its `ai-docs/`:
  services as `Context.Service` with a `layer`, named operations with `Effect.fn`, errors as
  `Schema.TaggedError`, and time, requests and state through `Clock`, `HttpClient` and `Ref` rather
  than `Date.now()`, `fetch` and `let`. Where Electron calls in, as `app` and `ipcMain` handlers do,
  run Effect code through the app's `ManagedRuntime` in `electron/runtime.ts`, and keep the handler
  to that.
- The board runs in the browser as React, which stays plain TypeScript, but it still decodes what
  it receives with `Schema` and uses `Option`, `Match` and Effect's other data types.
- Parse what comes from outside with `Schema` (`Schema.fromJsonString`, and `fromTomlString` and
  `fromYamlString` in `src/core/configText.ts`), not `try`/`catch` or `Predicate` checks, and return
  `Option` rather than `undefined` for a value that may be missing.
- Test Effect code with `test/effect.ts`, as OpenCode's tests do: `it.effect` runs on a `TestClock`
  the test moves, `it.live` on the real clock, and `testEffect(layer)` provides the services a file
  needs. Pure functions keep plain `test`.
- Write fewer comments. Make the code say it with names, types and structure; keep a comment only
  for what the code cannot say, such as a platform quirk or a public API contract. New code doesn't
  copy the comment density around it. `/no-comments` sweeps a diff.
- Keep each source file under 500 lines. When one grows past that, split it by responsibility into
  cohesive modules, not at arbitrary line boundaries. Split large intermediate work, such as
  generator scripts and generated files, the same way.
- All filesystem access goes through `Workspace` in `src/core/workspace.ts`; never bypass its root guard.
  Finding and creating a workspace before it opens, when there is no root to guard yet, lives in
  `src/core/workspaceRoot.ts`.
- Keep `src/core` free of HTTP and MCP concerns; MCP tools and API routes are thin adapters.
- Board text doesn't select by default, as in a native app. Content people would copy (chat, guides,
  errors, paths) opts in by wrapping it in `<SelectionArea>`; see `docs/ui.md`.
- Clickable things keep the arrow cursor, as in a native app, and show that they're clickable with a
  hover tint instead. Don't add `cursor-pointer`; see `docs/ui.md`.
- Workspace files are the source of truth. Do not add a database without a demonstrated need.
- The core must stay domain-agnostic; product- or niche-specific logic belongs in a workspace.
- Add a focused `bun:test` for parsing, status mapping, verification, and persistence changes.
- Use the `test-audit` skill in `.agents/skills/test-audit/` when writing, changing, reviewing or
  sweeping tests. A test earns its place by protecting observable behavior or an independent
  contract: name the regression that would make it fail, and test it once, at the boundary that
  owns it. Don't transcribe source, or assert what the types or a `Schema` already guarantee. A
  bug's regression test must fail on the code before the fix.
- To see and drive the desktop app, use argent: `bun run desktop:dev` opens Cutfac Dev with the
  DevTools Protocol on port 9222, or the port it logs, which argent's Chromium tools reach.
- Before finishing: `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run build` for web changes.
- Work directly in this checkout. Do not create git worktrees unless the user explicitly asks.
- Commits use Conventional Commits and stay atomic.
- New dependencies need a quick license, maintenance, and adoption check.
