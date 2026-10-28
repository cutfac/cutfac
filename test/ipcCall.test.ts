import { describe, expect } from "bun:test";

// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect";

import { ANY_INPUT, ipcCall, UnknownInput, UntrustedSender } from "../electron/ipcCall.ts";
import { LogDir, logToFile } from "../src/core/logFile.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

interface FakeEvent {
  readonly fromApp: boolean;
}

const fromApp: FakeEvent = { fromApp: true };

const trusted = (event: FakeEvent) => event.fromApp;

const KEY = { schema: Schema.String.check(Schema.isMaxLength(10)), what: "license key" };

class NotInWorkspace extends Schema.TaggedError<NotInWorkspace>()("NotInWorkspace", {
  message: Schema.String,
}) {}

const appLog = (dir: string) =>
  logToFile("app").pipe(
    Layer.provide([
      Layer.succeed(LogDir, Option.some(dir)),
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: "/Users/someone" } })),
    ]),
  );

/** A call on `channel` that counts how often it got as far as answering. */
const counted = Effect.gen(function* () {
  const answered = yield* Ref.make(0);

  const call = ipcCall("cutfac:set-license-key", trusted, KEY, (key: string) =>
    Effect.as(
      Ref.update(answered, (n) => n + 1),
      key.trim(),
    ),
  );

  return { call, answered: Ref.get(answered) };
});

describe("a call from a page", () => {
  it.live("answers the app's own page with what its input decodes to", () =>
    Effect.gen(function* () {
      const { call, answered } = yield* counted;

      expect(yield* call(fromApp, " KEY-1 ")).toBe("KEY-1");
      expect(yield* answered).toBe(1);
    }),
  );

  it.live("refuses a page that isn't the app's before answering it", () =>
    Effect.gen(function* () {
      const { call, answered } = yield* counted;
      const error = yield* Effect.flip(call({ fromApp: false }, "KEY-1"));

      expect(error).toBeInstanceOf(UntrustedSender);
      expect(yield* answered).toBe(0);
    }),
  );

  it.live("refuses input that doesn't decode, by what it should have been", () =>
    Effect.gen(function* () {
      const { call, answered } = yield* counted;
      const error = yield* Effect.flip(call(fromApp, "KEY-1".repeat(10)));

      expect(error).toBeInstanceOf(UnknownInput);
      expect(error.message).toBe("Unknown license key");
      expect(yield* answered).toBe(0);
    }),
  );

  it.live("leaves a line in the app's log when it fails, named after its channel", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-ipc-logs-" });

      const failing = ipcCall("cutfac:reveal-path", trusted, ANY_INPUT, () =>
        Effect.fail(new NotInWorkspace({ message: "not in the workspace" })),
      );

      yield* Effect.scoped(
        Effect.provide(
          Effect.andThen(
            Effect.ignore(failing(fromApp, undefined)),
            Effect.forEach(Array.from({ length: 5 }), () => Effect.yieldNow),
          ),
          appLog(dir),
        ),
      );

      const logs = yield* Effect.forEach(yield* fs.readDirectory(dir), (name) =>
        fs.readFileString(`${dir}/${name}`),
      );

      expect(logs.join("")).toContain("ipc cutfac:reveal-path took");
      expect(logs.join("")).toContain("and failed");
    }),
  );
});
