import path from "node:path";

import { Context, Effect, FileSystem, Layer, Option, Redacted, Schema, Semaphore } from "effect";
import type { Crypto } from "effect/Crypto";
import type { Path } from "effect/Path";

import { readAppFile, writeAppFile } from "../src/core/appData.ts";
import { PLATFORMS, PURPOSES } from "../src/core/brief.ts";
import { LicenseRecord, savedLicenseOf } from "../src/license.ts";
import type { OnboardingDraft as Draft, OnboardingStep } from "../web/src/desktop.ts";
import { LOCALES, type Locale } from "../web/src/i18n/locale.ts";
import { ONBOARDING_STEPS } from "./boardPages.ts";
import { LicenseNotSaved, LicenseSettings } from "./license.ts";
import { isSetAside, restore, setAside } from "./settingsAside.ts";
import { decodeWindowPlace, type WindowPlace } from "./windowPlace.ts";

export const OnboardingDraft = Schema.Struct({
  brief: Schema.Struct({
    purpose: Schema.NullOr(Schema.Literals(PURPOSES)),
    platforms: Schema.Array(Schema.Literals(PLATFORMS)),
    body: Schema.String,
  }),
  sources: Schema.Array(Schema.String),
  sharing: Schema.optionalKey(
    Schema.Struct({
      errorReports: Schema.optionalKey(Schema.Boolean),
      usageStats: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

const Page = Schema.Struct({
  workspace: Schema.NonEmptyString,
  hash: Schema.String.check(Schema.isPattern(/^#\//)),
});

interface Saved {
  workspace: string;
  library: string;
  port: number;
  locale: Locale;
  licenseKey: string;
  license: typeof LicenseRecord.Encoded | undefined;
  window: WindowPlace;
  page: typeof Page.Type;
  onboarding: OnboardingStep | undefined;
  onboardingDraft: typeof OnboardingDraft.Encoded | undefined;
  /** The app version the board last heard it was running, to say once that it updated. */
  seenVersion: string;
}

export class SettingsNotSaved extends Schema.TaggedError<SettingsNotSaved>()("SettingsNotSaved", {
  message: Schema.String,
}) {}

const SETTINGS_BYTES = 1024 * 1024;

const notSaved = (error: { readonly message: string }) =>
  new SettingsNotSaved({ message: error.message });

const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const decodeText = Schema.decodeUnknownOption(Schema.NonEmptyString);

const decodePort = Schema.decodeUnknownOption(
  Schema.Finite.check(Schema.isInt(), Schema.isBetween({ minimum: 1025, maximum: 65535 })),
);

const decodeLocale = Schema.decodeUnknownOption(Schema.Literals(LOCALES));

const decodePage = Schema.decodeUnknownOption(Page);

const decodeOnboarding = Schema.decodeUnknownOption(Schema.Literals(ONBOARDING_STEPS));

const decodeDraft = Schema.decodeUnknownOption(OnboardingDraft);

export interface SettingsPlace {
  readonly dir: string;
  readonly defaultLibrary: string;
}

export class Settings extends Context.Service<
  Settings,
  {
    readonly file: string;
    readonly defaultLibrary: string;
    readonly read: Effect.Effect<Schema.JsonObject>;
    write(patch: Partial<Saved>): Effect.Effect<void, SettingsNotSaved>;
    readonly written: Effect.Effect<void>;
    readonly setAside: Effect.Effect<void, SettingsNotSaved>;
    readonly restore: Effect.Effect<boolean, SettingsNotSaved>;
    readonly isSetAside: Effect.Effect<boolean>;
  }
>()("cutfac/desktop/Settings") {
  static readonly layer = (place: SettingsPlace) => Layer.effect(Settings, make(place));
}

const make = Effect.fnUntraced(function* ({ dir, defaultLibrary }: SettingsPlace) {
  const services = yield* Effect.context<FileSystem.FileSystem | Path | Crypto>();
  const lock = yield* Semaphore.make(1);
  const file = path.join(dir, "settings.json");
  const backup = path.join(dir, "settings.dev-backup.json");

  const readStored = readAppFile(file, SETTINGS_BYTES).pipe(
    Effect.map((text) => Option.getOrElse(Option.flatMap(text, decodeFile), () => ({}))),
    Effect.provideContext(services),
  );

  const read = Effect.orElseSucceed(readStored, (): Schema.JsonObject => ({}));

  const queued = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path | Crypto>) =>
    lock.withPermits(1)(Effect.provideContext(effect, services));

  const write = (patch: Partial<Saved>) =>
    queued(
      Effect.gen(function* () {
        const settings = { ...(yield* readStored), ...patch };

        yield* writeAppFile(file, `${JSON.stringify(settings, null, 2)}\n`);
      }),
    ).pipe(Effect.mapError(notSaved));

  return Settings.of({
    file,
    defaultLibrary,
    read,
    write,
    written: queued(Effect.void),
    setAside: queued(setAside(file, backup)).pipe(Effect.mapError(notSaved)),
    restore: queued(restore(file, backup)).pipe(Effect.mapError(notSaved)),
    isSetAside: Effect.provideContext(isSetAside(backup), services),
  });
});

const saved = (key: keyof Saved) =>
  Effect.flatMap(Settings, (settings) => Effect.map(settings.read, (read) => read[key]));

const save = (patch: Partial<Saved>) =>
  Effect.flatMap(Settings, (settings) => settings.write(patch));

export const settingsWritten = Effect.flatMap(Settings, (settings) => settings.written);

export const loadWorkspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const workspace = decodeText(yield* saved("workspace"));

  if (Option.isNone(workspace)) return workspace;

  const info = yield* Effect.option(fs.stat(workspace.value));

  return Option.isSome(info) && info.value.type === "Directory" ? workspace : Option.none<string>();
});

export const loadLibrary = Effect.gen(function* () {
  const { defaultLibrary } = yield* Settings;

  return Option.getOrElse(decodeText(yield* saved("library")), () => defaultLibrary);
});

export const saveLibrary = (library: string) => save({ library });

export const saveWorkspace = (workspace: string) => save({ workspace, onboarding: undefined });

export const loadPort = Effect.map(saved("port"), decodePort);

export const savePort = (port: number) => save({ port });

export const loadLocale = Effect.map(saved("locale"), decodeLocale);

export const saveLocale = (locale: Locale) => save({ locale });

export const loadSeenVersion = Effect.map(saved("seenVersion"), decodeText);

export const saveSeenVersion = (seenVersion: string) => save({ seenVersion });

const encodeLicense = Schema.encodeEffect(Schema.UndefinedOr(LicenseRecord));

export const licenseSettings = Layer.effect(
  LicenseSettings,
  Effect.gen(function* () {
    const settings = yield* Settings;

    return LicenseSettings.of({
      load: Effect.map(settings.read, savedLicenseOf),
      save: (licenseKey, record) =>
        encodeLicense(Option.getOrUndefined(record)).pipe(
          Effect.flatMap((license) =>
            settings.write({ licenseKey: Redacted.value(licenseKey), license }),
          ),
          Effect.mapError((cause) => new LicenseNotSaved({ cause })),
        ),
    });
  }),
);

export const loadWindowPlace = Effect.map(saved("window"), decodeWindowPlace);

export const saveWindowPlace = (place: WindowPlace) => save({ window: place });

export const loadPage = (workspace: string) =>
  Effect.map(saved("page"), (page) =>
    Option.flatMap(decodePage(page), (found) =>
      found.workspace === workspace ? Option.some(found.hash) : Option.none(),
    ),
  );

export const savePage = (workspace: string, hash: string) => save({ page: { workspace, hash } });

export const loadOnboarding = Effect.map(saved("onboarding"), decodeOnboarding);

export const saveOnboarding = (onboarding: OnboardingStep) => save({ onboarding });

export const loadDraft = Effect.map(saved("onboardingDraft"), (value) =>
  Option.map(decodeDraft(value), (draft) => {
    const copy: Draft = {
      brief: { ...draft.brief, platforms: [...draft.brief.platforms] },
      sources: [...draft.sources],
    };

    if (draft.sharing !== undefined) copy.sharing = { ...draft.sharing };

    return copy;
  }),
);

export const saveDraft = (draft: typeof OnboardingDraft.Type) => save({ onboardingDraft: draft });

export const clearDraft = save({ onboardingDraft: undefined });

export const settingsFile = Effect.map(Settings, (settings) => settings.file);

export const setSettingsAside = Effect.flatMap(Settings, (settings) => settings.setAside);

export const restoreSettings = Effect.flatMap(Settings, (settings) => settings.restore);

export const settingsSetAside = Effect.flatMap(Settings, (settings) => settings.isSetAside);
