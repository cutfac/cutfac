import { Clock, Config, Context, Effect, Layer, Option, Path, Schema } from "effect";

import { COMPILED } from "../core/build.ts";
import { Workspace } from "../core/workspace.ts";
import { CUSTOMER_PORTAL_URL, LicenseLock, PRICING_URL, lockInSettings } from "../license.ts";

/** The app's settings file is a few hundred bytes; anything past this isn't one. */
const SETTINGS_BYTES = 64 * 1024;

/** Where the desktop app keeps the binary it bundles, as opposed to the CLI built from source. */
const BUNDLED_BINARY = /\.app\/Contents\/Resources\/bin\/[^/]+$/;

/** A tool call refused because the desktop app that bundles this server is locked. */
export class LicenseLocked extends Schema.TaggedError<LicenseLocked>()("LicenseLocked", {
  lock: LicenseLock,
  message: Schema.String,
}) {}

type Gate = Effect.Effect<void, LicenseLocked>;

/** Runs before each tool. Open unless the desktop app's binary provides `desktopLicenseGate`. */
export const LicenseGate = Context.Reference<Gate>("cutfac/LicenseGate", {
  defaultValue: () => Effect.void,
});

const UNLOCK_NOTE =
  " Their workspace files are untouched, and the open-source Cutfac CLI works without a license." +
  " This is not a bug in Cutfac, so don't offer to report it.";

const LOCK_MESSAGES: Record<LicenseLock, string> = {
  missing:
    "Cutfac is locked: no license key is saved in the Cutfac app. Tell the user to start the free " +
    `7-day trial or choose a plan at ${PRICING_URL}, then enter the key in the Cutfac app ` +
    "(Cutfac menu → License Key…).",
  invalid:
    "Cutfac is locked: the license key saved in the Cutfac app isn't valid. Tell the user to enter " +
    "the key from their trial or purchase email in the Cutfac app (Cutfac menu → License Key…), " +
    `or to get one at ${PRICING_URL}.`,
  ended:
    "Cutfac is locked: the user's free trial or plan has ended. Tell them to subscribe at " +
    `${PRICING_URL} or renew at ${CUSTOMER_PORTAL_URL}, then open the Cutfac app.`,
  offline:
    "Cutfac is locked: the Cutfac app hasn't confirmed its license with cutfac.com in the last " +
    "7 days. Tell the user to open the Cutfac app while online.",
};

/** The desktop app's settings file, when this server is the binary the app bundles. */
const desktopSettingsFile = Effect.gen(function* () {
  if (!COMPILED || !BUNDLED_BINARY.test(process.execPath)) return Option.none<string>();
  const path = yield* Path.Path;

  const home = yield* Config.option(Config.String("HOME")).pipe(
    Effect.orElseSucceed(Option.none<string>),
  );

  return Option.map(home, (dir) =>
    path.join(dir, "Library", "Application Support", "Cutfac", "settings.json"),
  );
});

/**
 * Fails while the desktop app's settings file says the app is locked. A file that can't be read
 * passes: only the app decides it is locked.
 */
const checkSettings = (ws: Workspace["Service"], file: string): Gate =>
  Effect.gen(function* () {
    const text = yield* ws.peekText(file, SETTINGS_BYTES).pipe(Effect.option);

    if (Option.isNone(text)) return;
    const lock = lockInSettings(text.value, yield* Clock.currentTimeMillis);

    if (lock !== undefined) {
      return yield* new LicenseLocked({ lock, message: LOCK_MESSAGES[lock] + UNLOCK_NOTE });
    }
  });

/** Lock the tools whenever the desktop app is locked, when this server is the binary it bundles. */
export const desktopLicenseGate = Layer.effect(
  LicenseGate,
  Effect.flatMap(desktopSettingsFile, (file) =>
    Option.isNone(file)
      ? Effect.succeed<Gate>(Effect.void)
      : Effect.map(Workspace, (ws) => checkSettings(ws, file.value)),
  ),
);
