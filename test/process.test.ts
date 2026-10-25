import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { refuse } from "../src/core/approval.ts";
import { addFeedback, createItem } from "../src/core/items.ts";
import { run } from "../src/core/process.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

const DAEMON = "CODEX_APP_SERVER_USE_LOCAL_DAEMON";

describe("a command Cutfac runs on a Mac where the Codex desktop app is set up", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;
  let seen: string;
  const before = process.env[DAEMON];

  beforeEach(async () => {
    t = await makeWorkspace("Daemon");
    fakes = await makeFakeAgents();
    seen = join(fakes.calls, "seen");
    // What the desktop app hands every app the user opens.
    process.env[DAEMON] = "1";
    // Lists no servers of its own, as `codex mcp list --json` would.
    await fakes.bin(
      "codex",
      `echo "$1 \${${DAEMON}-unset}" >> "${seen}"\n[ "$1" = mcp ] && echo "[]"\n`,
    );
  });

  afterEach(async () => {
    if (before === undefined) delete process.env[DAEMON];
    else process.env[DAEMON] = before;
    await fakes.remove();
    await t.remove();
  });

  const lines = async () => (await readFile(seen, "utf8")).trim().split("\n");

  test("doesn't pass on the desktop app's daemon setting, which stops `codex exec`", async () => {
    await t.runWith(fakes.layer, run(join(fakes.dir, "bin", "codex"), ["mcp"]));

    expect(await lines()).toEqual(["mcp unset"]);
  });

  test("leaves it out of an edit run's Codex too", async () => {
    await t.runWith(
      fakes.layer,
      Effect.gen(function* () {
        const created = yield* createItem({ title: "Clip" });
        const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });

        yield* runEdit(undefined)(
          { itemId: created.id, feedbackId: feedback.id, agent: "codex" },
          () => Effect.void,
          refuse,
        );
      }),
    );

    const calls = await lines();

    expect(calls).toContain("exec unset");
    expect(calls.every((line) => line.endsWith(" unset"))).toBe(true);
  });
});
