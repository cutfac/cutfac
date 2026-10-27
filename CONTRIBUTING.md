# Contributing to Cutfac

Thanks for helping. Bug reports, fixes, and ideas are all welcome.

## Before you start

- For a bug, open an issue with what you did, what you expected, and what happened. Include your
  OS, your Cutfac version or commit, and which agent you used.
- For a feature or a larger change, open an issue first so we can agree on the approach before you
  write it. Cutfac is agent-first: a feature should work through the tools an agent already calls
  before it gets a button on the board. [AGENTS.md](AGENTS.md) lists the principles we weigh
  changes by.
- A pull request needs an issue we agreed on first, except for typos and small, obvious fixes.
  Pull requests without one are closed, however good they are.
- Report security problems privately, as [SECURITY.md](SECURITY.md) describes, not in an issue.

## Setup

You need [Bun](https://bun.sh) 1.3+ and ffmpeg/ffprobe. `yt-dlp` and `whisper` are optional.

```sh
bun install
bun run build
bun run serve -- --workspace <dir>   # API and board on :4317
bun run dev:web                      # board with hot reload on :5173
```

`bun run desktop:dev` runs the Mac app on live code. [docs/desktop.md](docs/desktop.md#running-it-from-source) has more.

## Checks

Run these before you open a pull request. CI runs the same ones.

```sh
bun test
bun run typecheck
bun run lint
bun run format:check
bun run build
```

`bun run format` fixes formatting. Tests never call the real Claude Code or Codex CLIs, `yt-dlp`, or
the network, so they run anywhere.

## Code

[AGENTS.md](AGENTS.md) has the conventions, and it is also what your coding agent should read.
The main ones:

- Bun only, strict TypeScript, oxlint and oxfmt.
- All filesystem access goes through `Workspace` in `src/core/workspace.ts`.
- `src/core` stays free of HTTP and MCP code and of anything specific to one product or niche.
- Workspace files are the source of truth; there is no database.
- Parsing, status mapping, verification, and persistence changes come with a focused `bun:test`.
- A new dependency needs a reason, and a quick check of its license, maintenance, and adoption.

Writing your change with an agent is fine. You are still the one who answers for it, so read the
diff and run the checks before you send it, and say in the pull request whether and how you used
one. Pull requests that look generated and unread, or that the author can't explain, are closed
without a detailed review.

`AGENTS.md`, `CLAUDE.md` and `skills/` are instructions agents follow, and `SKILL.md` ships to
every user's agent. Change them only when the issue calls for it, and expect a close review.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org) (`fix(board): …`,
  `feat(core): …`) and keep each commit to one change.
- Keep pull requests small. Say what changes and why, and add a screenshot for changes to the
  board.

## License

Cutfac is licensed under the [GNU Affero General Public License v3.0](LICENSE) only. Before we can
merge your first pull request, you accept a Contributor License Agreement, adapted from the Apache
Software Foundation's:

- Everyone signs the [Individual CLA](ICLA.md) once. On your first pull request, CLA assistant
  comments with a link; sign there with your GitHub account. It records the version you signed and
  when, and covers every pull request after it.
- If you contribute as part of your job, your employer also signs the [Corporate CLA](CCLA.md) and
  names you in its Schedule A. Write to [legal@cutfac.com](mailto:legal@cutfac.com), and we'll send
  it to sign.

[ICLA.ko.md](ICLA.ko.md) and [CCLA.ko.md](CCLA.ko.md) are Korean translations for reference; the
English text is the agreement. You keep the copyright to your work; the agreement lets Wyverse Labs
ship it under the AGPL and under other terms, such as in the signed Mac app.

The license doesn't cover the Cutfac name, logo or icon. [TRADEMARKS.md](TRADEMARKS.md) says how to
use them and what a fork you distribute should change.
