---
name: test-audit
description: "Invoke whenever writing, changing, reviewing, or sweeping tests. Authoring gate for new tests plus audit workflow for low-value, implementation-coupled, or duplicative tests and the test-only production seams they demand."
license: MIT
metadata:
  source: openclaw/openclaw/.agents/skills/test-audit@80930af448ebabc84174146b56bc106d37fab3b4
---

# Test Audit

Three modes, one value bar. Authoring mode gates every new or changed test at
write time. Audit mode runs focused sweeps of tests that re-assert source,
duplicate stronger proof, couple behavior to implementation, or keep test-only
production seams alive. Continue broad audits as separate coherent follow-up
commits; optimize for confidence, not deletion count. Campaign mode prunes one
whole subsystem's test surface (every test file a feature or core area owns);
before starting one, read [CAMPAIGN.md](CAMPAIGN.md).

## Authoring gate

Before adding any test, answer four questions; a missing answer means do not
add it yet:

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that failure? Each contract has
   one primary test owner at the strongest boundary; another layer needs its
   own distinct risk, such as a persistence or lifecycle failure the owner
   cannot reach. Prefer extending a table-driven case or shared fixture over a
   near-duplicate test; consolidate duplicated setup in the same change.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no
   production caller needs? If yes, move the test to the real boundary instead.
   A `Context.Service` or `Context.Reference` that production provides through
   a layer is not such a seam: replace it with `testEffect(layer)`,
   `Effect.provideService` or `Layer.succeed`, as `test/effect.ts` expects.

Then check the test against every [junk pattern](#junk-patterns); a match fails
the gate unless the [retention bar](#retention-bar) names the contract it
independently guards. A test that would break under behavior-preserving
refactoring is asserting implementation, not behavior; rewrite it at the
owning boundary before landing it.

Bug regression tests must fail on the pre-fix code for the intended reason and
pass after the owner-boundary repair. A regression test that never demonstrably
failed proves the mock, not the fix. One regression at the owner boundary
covers the bug; do not replay the same scenario at every layer it crosses.

Time-dependent Effect code runs under `it.effect`, which moves a `TestClock`;
use `it.live` only for real I/O such as a child process, a socket or the file
system. A test that sleeps on the wall clock to wait for an effect is a flake
waiting to happen: wait on the effect, a `Deferred` or the observable result.

## Junk patterns

The shared checklist for both modes: the authoring gate rejects a new test that
matches one, and audits hunt for existing tests that do.

- assertion-free coverage probes;
- self-comparisons and identity copiers;
- copied fixtures, inventories, manifests, or export lists;
- exact source, import, or string greps;
- private predicate or call-shape tests duplicated at real boundaries;
- duplicate invocations of the same contract;
- feature-local replays of shared helpers;
- tests whose only purpose is preserving test-only exports, globals, or wrappers;
- dead production code whose only callers are tests;
- expected values produced by the helper or renderer under test;
- mocks that implement the asserted behavior, or one identical mock standing in
  for different APIs;
- fixtures that supply the receipt, admission, or callback ordering the owner
  should produce, or persistence asserted against a store the path never writes;
- capability tests that restate declared flags instead of exercising the
  delivery or acknowledgement the flag promises;
- negative controls that pass for an unrelated reason, such as a denial from a
  different guard or a rejection the production path never reaches;
- names or fixtures that promise more than the input exercises, such as a
  "retires the window" test asserting the window was not cleared;
- assertions of what the types or a `Schema` already guarantee by construction.

## Value bar

Tests justify their maintenance cost by protecting behavior, a credible
regression, or an independently meaningful contract. In an audit, an existing
test that must change for behavior-preserving source reorganization is suspect,
not automatically deletable; the authoring gate still rejects new ones.

Before judging a candidate, read the complete test and production owner, its
entry point, callers, callees, sibling implementations, overlapping tests, CI
routing, and relevant history. Read `AGENTS.md` first. When the test claims
dependency-backed behavior, such as Effect, Electron or an agent CLI, inspect
the dependency source or types directly.

## Discovery

Keep discovery read-only and report evidence before editing. Tests live flat in
`test/`, named after the module they own (`render.test.ts`), with `-ui` for the
board's (`render-ui.test.ts`). For broad scope, split discovery into lanes, and
run them in parallel only when the user authorized sub-agents:

- the core (`src/core/`) and the process entry points (`src/cli.ts`,
  `src/errorReports.ts`, `src/usageStats.ts`);
- the adapters: the local API (`src/server/`) and the MCP tools (`src/mcp/`);
- the desktop app's main process (`electron/`);
- the board (`web/src/`), the agent skill (`skills/`), and tooling (`tools/`);
- a cross-cutting pattern sweep.

Outside campaign mode, prefer a few high-confidence candidates over a large
speculative inventory. Hunt for the [junk patterns](#junk-patterns).

## Retention bar

Keep a test when it independently enforces a public API, MCP tool, local API
route, workspace file format, migration, persistence, the workspace root guard
or another security boundary, a platform, default, render output, agent setup,
license or plan, localization resource, telemetry privacy (what leaves the
machine and when), release, or architecture contract. Also keep:

- call ordering when order is observable behavior;
- regressions with a credible failure mode;
- source inspection when it is the cheapest independent guard: it fails when
  the contract changes (the user-facing key, byte, or path) and survives an
  identifier-only refactor;
- a retained test that fails on the baseline: treat it as a possible product
  bug, reproduce it, and repair the owner rather than deleting it.

Static or slow is not a deletion reason. A test that resembles implementation
may still be the independent contract; prove otherwise before removing it.

## Candidate evidence

Record every field below before editing. A missing field means the candidate is
not ready for deletion:

- exact test name and location;
- what failure it can actually detect;
- non-test callers of the covered production or support seam;
- stronger remaining owner-boundary proof, or why no proof is needed;
- relevant history and the reason the test or seam exists;
- production or test-support deletion unlocked;
- risk and the focused validation command.

## Edit shape

Choose one coherent owner-boundary batch. Delete obsolete test-only exports,
globals, wrappers, and dead production paths instead of preserving aliases.
Move retained regressions to their canonical owners. Consolidate repeated
package or dependency assertions into one generic contract.

Prefer net-negative production LOC. Do not add replacement tests that restate
the same implementation, and do not convert uncertain candidates into cleanup
to increase deletion counts.

## Validation

Never edit source or tests while `bun test` is running in the checkout.

1. Run the smallest owner and sibling tests with `bun test <path-or-filter>`.
2. For a contract you claim a test guards, prove it: break the owner on
   purpose, confirm that test goes red for the intended reason, then restore
   the source byte for byte.
3. For removed source greps or plan assertions, run the executable script or
   dry-run that owns the real contract.
4. Run `bunx oxfmt <changed-paths>`, then `git diff --check`.
5. Run the checks `AGENTS.md` lists before finishing: `bun test`,
   `bun run typecheck`, `bun run lint`, `bun run format:check`, and
   `bun run build` for board changes.
6. Inspect `git diff --numstat`; report production/tooling separately from
   tests and test support.
7. After final audit edits, review the diff for correctness before handoff.

## Landing and continuation

Commit, push, open a PR, or land only when authorized. Use Conventional
Commits and keep commits atomic. Land one coherent batch at a time; after
landing, refresh from current `main` and rerun read-only discovery for the next
high-confidence batch.

## Handoff

Report:

- root cause and removed low-value categories;
- production owner simplifications;
- retained false positives and why they remain valuable;
- focused and full proof actually run;
- production versus test LOC;
- commit or PR state;
- named follow-ups.
