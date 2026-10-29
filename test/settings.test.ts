import { describe, expect } from "bun:test";
import path from "node:path";

// @effect-diagnostics strictEffectProvide:off
import { Effect, Exit, FileSystem, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { LicenseSettings } from "../electron/license.ts";
import { platform } from "../electron/platform.ts";
import {
  clearDraft,
  licenseSettings,
  loadDraft,
  loadLibrary,
  loadLocale,
  loadOnboarding,
  loadPage,
  loadPort,
  loadWorkspace,
  saveDraft,
  saveLibrary,
  saveLocale,
  saveOnboarding,
  savePage,
  savePort,
  saveWorkspace,
  Settings,
  settingsWritten,
  updatedTo,
} from "../electron/settings.ts";
import { LicenseKey, LicenseRecord, paidInSettings } from "../src/license.ts";
import { testEffect } from "./effect.ts";
import { signedGrant, testLicenseKey } from "./support.ts";

const it = testEffect(platform);

const DEFAULT_LIBRARY = "/Users/ada/Movies/Cutfac";

const decodeSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

const appData = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-settings-" });
  const file = path.join(dir, "settings.json");

  const saved = Effect.flatMap(fs.readFileString(file), decodeSettings);

  const settingsIn = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provide(effect, Settings.layer({ dir, defaultLibrary: DEFAULT_LIBRARY }));

  return { dir, file, saved, settingsIn };
});

describe("saving the settings", () => {
  it.live("keeps what a save doesn't change, fields this version can't read included", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, saved, settingsIn } = yield* appData;

      yield* fs.writeFileString(file, JSON.stringify({ locale: "ko", future: { kept: true } }));
      yield* settingsIn(savePort(4321));

      expect(yield* saved).toEqual({ locale: "ko", future: { kept: true }, port: 4321 });
    }),
  );

  it.live("keeps each of several saves made at once", () =>
    Effect.gen(function* () {
      const { saved, settingsIn } = yield* appData;

      yield* settingsIn(
        Effect.all(
          [
            savePort(4321),
            saveLocale("ko"),
            saveLibrary("/Volumes/Work/Cutfac"),
            savePage("/work", "#/item/a"),
          ],
          { concurrency: "unbounded" },
        ),
      );

      expect(yield* saved).toEqual({
        port: 4321,
        locale: "ko",
        library: "/Volumes/Work/Cutfac",
        page: { workspace: "/work", hash: "#/item/a" },
      });
    }),
  );

  it.live("reads a file it can't make sense of as empty, and replaces it on the next save", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, saved, settingsIn } = yield* appData;

      yield* fs.writeFileString(file, "{ half written");

      expect(yield* settingsIn(loadLocale)).toEqual(Option.none());

      yield* settingsIn(saveLocale("en"));

      expect(yield* saved).toEqual({ locale: "en" });
    }),
  );

  it.live("doesn't save over a file it couldn't read, which would lose what it holds", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, saved, settingsIn } = yield* appData;
      const before = { licenseKey: "KEY-1", workspace: "/work" };

      yield* fs.writeFileString(file, JSON.stringify(before));
      yield* fs.chmod(file, 0o000);

      expect(yield* settingsIn(loadWorkspace)).toEqual(Option.none());

      const exit = yield* Effect.exit(settingsIn(saveLocale("ko")));

      yield* fs.chmod(file, 0o644);

      expect(yield* saved).toEqual(before);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.live("waits on quit for the saves started before it", () =>
    Effect.gen(function* () {
      const { saved, settingsIn } = yield* appData;

      yield* settingsIn(
        Effect.gen(function* () {
          yield* Effect.forkScoped(savePort(4321), { startImmediately: true });
          yield* settingsWritten;
        }),
      );

      expect(yield* saved).toEqual({ port: 4321 });
    }),
  );
});

describe("loading the settings", () => {
  it.live("reads each field on its own, so one it can't read leaves the others", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, settingsIn } = yield* appData;

      yield* fs.writeFileString(
        file,
        JSON.stringify({ port: 80, locale: "ko", onboarding: "somewhere", library: "" }),
      );

      expect(yield* settingsIn(loadPort)).toEqual(Option.none());
      expect(yield* settingsIn(loadLocale)).toEqual(Option.some("ko"));
      expect(yield* settingsIn(loadOnboarding)).toEqual(Option.none());
      expect(yield* settingsIn(loadLibrary)).toBe(DEFAULT_LIBRARY);
    }),
  );

  it.live("opens the last workspace only while its folder is still there", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { dir, settingsIn } = yield* appData;
      const workspace = path.join(dir, "Channel");

      yield* fs.makeDirectory(workspace);
      yield* settingsIn(saveWorkspace(workspace));

      expect(yield* settingsIn(loadWorkspace)).toEqual(Option.some(workspace));

      yield* fs.remove(workspace, { recursive: true });

      expect(yield* settingsIn(loadWorkspace)).toEqual(Option.none());
    }),
  );

  it.live("brings a page back only in the workspace it was shown in", () =>
    Effect.gen(function* () {
      const { settingsIn } = yield* appData;

      yield* settingsIn(savePage("/work/a", "#/item/x"));

      expect(yield* settingsIn(loadPage("/work/a"))).toEqual(Option.some("#/item/x"));
      expect(yield* settingsIn(loadPage("/work/b"))).toEqual(Option.none());
    }),
  );

  it.live(
    "keeps the first launch's step and answers until a workspace opens and they're cleared",
    () =>
      Effect.gen(function* () {
        const { settingsIn } = yield* appData;

        const draft = {
          brief: { purpose: null, platforms: [], body: "Recipes" },
          sources: ["https://example.com"],
          sharing: { errorReports: true },
        };

        yield* settingsIn(saveOnboarding("make"));
        yield* settingsIn(saveDraft(draft));

        expect(yield* settingsIn(loadOnboarding)).toEqual(Option.some("make"));
        expect(yield* settingsIn(loadDraft)).toEqual(Option.some(draft));

        yield* settingsIn(saveWorkspace("/work"));
        yield* settingsIn(clearDraft);

        expect(yield* settingsIn(loadOnboarding)).toEqual(Option.none());
        expect(yield* settingsIn(loadDraft)).toEqual(Option.none());
      }),
  );
});

describe("the license in the settings", () => {
  it.effect(
    "a license the app saves unlocks the paid plan for the agent tools reading the file, until it's cleared",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { file, settingsIn } = yield* appData;
        const now = Date.UTC(2026, 9, 1);
        const key = Redacted.make(LicenseKey.make("KEY-1"));
        const record = LicenseRecord.cases.LicenseGrant.make({ token: signedGrant(now) });

        yield* TestClock.setTime(now);
        yield* settingsIn(
          Effect.gen(function* () {
            const license = yield* LicenseSettings;

            yield* license.save(key, Option.some(record), Option.some("act-1"));

            const loaded = yield* license.load;

            expect(Option.map(loaded.key, Redacted.value)).toEqual(
              Option.some(LicenseKey.make("KEY-1")),
            );
            expect(loaded.record).toEqual(Option.some(record));
            expect(loaded.activation).toEqual(Option.some("act-1"));
          }).pipe(Effect.provide(licenseSettings)),
        );

        expect(yield* paidInSettings(yield* fs.readFileString(file))).toBe(true);

        yield* settingsIn(
          Effect.gen(function* () {
            const license = yield* LicenseSettings;

            yield* license.clear;

            const loaded = yield* license.load;

            expect(Option.isNone(loaded.key)).toBe(true);
            expect(Option.isNone(loaded.record)).toBe(true);
            expect(Option.isNone(loaded.activation)).toBe(true);
          }).pipe(Effect.provide(licenseSettings)),
        );

        expect(yield* paidInSettings(yield* fs.readFileString(file))).toBe(false);
      }).pipe(Effect.provide(testLicenseKey)),
  );
});

describe("saying once that the app updated", () => {
  it.effect.each([
    {
      ran: "a version that saved what it was",
      stored: { seenVersion: "0.4.3", workspace: "/work" },
      says: Option.some("0.4.4"),
    },
    {
      ran: "a version before 0.4.3, which saved only its workspace",
      stored: { workspace: "/work" },
      says: Option.some("0.4.4"),
    },
    { ran: "nothing yet, as on a first launch", stored: {}, says: Option.none<string>() },
  ])("after $ran, says what it updated to, then nothing", ({ stored, says }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, settingsIn } = yield* appData;

      yield* fs.writeFileString(file, JSON.stringify(stored));

      expect(yield* settingsIn(updatedTo("0.4.4"))).toEqual(says);

      yield* settingsIn(saveWorkspace("/work"));

      expect(yield* settingsIn(updatedTo("0.4.4"))).toEqual(Option.none());
    }),
  );
});
