import { describe, expect, test } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option } from "effect";

import { INSTALL_COMMAND, SIGN_IN_COMMAND, agentSetup, readiness } from "../src/core/agentSetup.ts";
import { MIN_AGENT_VERSION } from "../src/core/agentVersion.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents } from "./support.ts";

const it = testEffect(Layer.merge(fakeAgents, BunServices.layer));

const NATIVE = "/Users/ada/.local/share/claude/versions/2.1.1";

/** A fake CLI that says its version, and answers everything else with `rest`. */
const answering = (version: string, rest: string) =>
  `if [ "$1" = "--version" ]; then echo '${version}'; exit 0; fi\n${rest}`;

describe("what an installed agent needs", () => {
  test("an old release needs its update first, whatever its sign-in", () => {
    expect(
      readiness("claude", Option.some({ version: "2.1.1", installedAt: NATIVE }), false),
    ).toEqual({
      state: "outdated",
      version: "2.1.1",
      fix: "claude update",
    });
  });

  test("a signed-out agent needs its sign-in", () => {
    expect(
      readiness("codex", Option.some({ version: "99.0.0", installedAt: "/x/codex" }), false),
    ).toEqual({
      state: "signedOut",
      version: "99.0.0",
      fix: SIGN_IN_COMMAND.codex,
    });
  });

  test("an agent that can't say holds nothing up", () => {
    expect(readiness("claude", Option.none(), undefined)).toEqual({
      state: "ready",
      version: undefined,
    });
  });
});

describe("agents on this machine", () => {
  it.live("finds each agent's install, release and sign-in", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin(
        "claude",
        answering(
          `${MIN_AGENT_VERSION.claude} (Claude Code)`,
          `echo '{"loggedIn": false, "authMethod": "none"}'\nexit 1\n`,
        ),
      );

      expect(yield* agentSetup()).toEqual([
        {
          agent: "claude",
          state: "signedOut",
          version: MIN_AGENT_VERSION.claude,
          fix: SIGN_IN_COMMAND.claude,
        },
        { agent: "codex", state: "missing", fix: INSTALL_COMMAND.codex },
      ]);
    }),
  );

  it.live("a signed-in agent is ready, and codex says so by its exit code", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin("claude", answering("99.0.0 (Claude Code)", `echo '{"loggedIn": true}'\n`));
      yield* fakes.bin("codex", answering("codex-cli 99.0.0", "echo 'Logged in using ChatGPT'\n"));

      const setups = yield* agentSetup();

      expect(setups.map((setup) => setup.state)).toEqual(["ready", "ready"]);
      expect(setups.every((setup) => setup.fix === undefined)).toBe(true);
    }),
  );
});
