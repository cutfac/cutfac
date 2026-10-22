import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { INSTALL_COMMAND, SIGN_IN_COMMAND, agentSetup, readiness } from "../src/core/agentSetup.ts";
import { MIN_AGENT_VERSION } from "../src/core/agentVersion.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

const NATIVE = "/Users/ada/.local/share/claude/versions/2.1.1";

/** A fake CLI that says its version, and answers everything else with `rest`. */
const answering = (version: string, rest: string) =>
  `if [ "$1" = "--version" ]; then echo '${version}'; exit 0; fi\n${rest}`;

describe("what an installed agent needs", () => {
  test("an old release needs its update first, whatever its sign-in", () => {
    expect(readiness("claude", { version: "2.1.1", installedAt: NATIVE }, false)).toEqual({
      state: "outdated",
      version: "2.1.1",
      fix: "claude update",
    });
  });

  test("a signed-out agent needs its sign-in", () => {
    expect(readiness("codex", { version: "99.0.0", installedAt: "/x/codex" }, false)).toEqual({
      state: "signedOut",
      version: "99.0.0",
      fix: SIGN_IN_COMMAND.codex,
    });
  });

  test("an agent that can't say holds nothing up", () => {
    expect(readiness("claude", undefined, undefined)).toEqual({
      state: "ready",
      version: undefined,
    });
  });
});

describe("agents on this machine", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Agent setup");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  test("finds each agent's install, release and sign-in", async () => {
    await fakes.bin(
      "claude",
      answering(
        `${MIN_AGENT_VERSION.claude} (Claude Code)`,
        `echo '{"loggedIn": false, "authMethod": "none"}'\nexit 1\n`,
      ),
    );

    expect(await t.runWith(fakes.layer, agentSetup())).toEqual([
      {
        agent: "claude",
        state: "signedOut",
        version: MIN_AGENT_VERSION.claude,
        fix: SIGN_IN_COMMAND.claude,
      },
      { agent: "codex", state: "missing", fix: INSTALL_COMMAND.codex },
    ]);
  });

  test("a signed-in agent is ready, and codex says so by its exit code", async () => {
    await fakes.bin("claude", answering("99.0.0 (Claude Code)", `echo '{"loggedIn": true}'\n`));
    await fakes.bin("codex", answering("codex-cli 99.0.0", "echo 'Logged in using ChatGPT'\n"));

    const setups = await t.runWith(fakes.layer, agentSetup());

    expect(setups.map((setup) => setup.state)).toEqual(["ready", "ready"]);
    expect(setups.every((setup) => setup.fix === undefined)).toBe(true);
  });
});
