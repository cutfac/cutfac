import { Clock, Config, Context, Effect, Layer, Option, Path, Schema } from "effect";

import { COMPILED } from "./core/build.ts";
import { type NewItemInput, createItem } from "./core/items.ts";
import { Workspace, appendAppRecord, nowIso } from "./core/workspace.ts";
import { LICENSE_PUBLIC_KEY, paidInSettings } from "./license.ts";

/** How many videos the desktop app's free version makes on one Mac, with every feature open. */
export const FREE_VIDEOS = 3;

/** Where the free version and its agent tools send people. The board keeps its own copy. */
export const PRICING_URL = "https://cutfac.com/pricing";

/** The app's settings file is a few hundred bytes; anything past this isn't one. */
const SETTINGS_BYTES = 64 * 1024;

/** A line per video, so the start of the file holds far more lines than the count needs. */
const VIDEOS_BYTES = 64 * 1024;

/** The time each new video was made on this Mac, a line each, paid or not. */
const VIDEOS_FILE = "videos.log";

/** Where the desktop app keeps the binary it bundles, as opposed to the CLI built from source. */
const BUNDLED_BINARY = /\.app\/Contents\/Resources\/bin\/[^/]+$/;

/**
 * The desktop app's data folder, which holds its license and the count of videos made, when this
 * process belongs to the desktop app. None for the open-source CLI, which has no limit.
 */
export const DesktopData = Context.Reference<Option.Option<string>>("cutfac/DesktopData", {
  defaultValue: () => Option.none(),
});

/** The key that verifies cutfac.com's license grants. Tests sign their own. */
export const LicensePublicKey = Context.Reference<typeof LICENSE_PUBLIC_KEY>(
  "cutfac/LicensePublicKey",
  {
    defaultValue: () => LICENSE_PUBLIC_KEY,
  },
);

const env = (name: string) =>
  Config.option(Config.String(name)).pipe(Effect.orElseSucceed(Option.none<string>));

/**
 * The app's folder in Application Support when this is the binary the desktop app bundles. From
 * source, CUTFAC_DESKTOP_DATA names a folder to try the free version with.
 */
export const desktopData = Layer.effect(
  DesktopData,
  Effect.gen(function* () {
    if (!COMPILED || !BUNDLED_BINARY.test(process.execPath))
      return yield* env("CUTFAC_DESKTOP_DATA");
    const path = yield* Path.Path;

    return Option.map(yield* env("HOME"), (home) =>
      path.join(home, "Library", "Application Support", "Cutfac"),
    );
  }),
);

/** The open-source CLI; the desktop app on a paid plan; or its free version, with videos made. */
export type Plan =
  | { readonly edition: "open-source" }
  | { readonly edition: "desktop"; readonly paid: true }
  | {
      readonly edition: "desktop";
      readonly paid: false;
      readonly used: number;
      readonly limit: number;
    };

const OPEN_SOURCE: Plan = { edition: "open-source" };

const PAID: Plan = { edition: "desktop", paid: true };

/** What the desktop app's settings and video count say about the plan at `now`. */
export function planOf(
  settings: string | undefined,
  videos: string,
  now: number,
  publicKey = LICENSE_PUBLIC_KEY,
): Plan {
  if (settings !== undefined && paidInSettings(settings, now, publicKey)) return PAID;

  const made = videos.split("\n").filter((line) => line.trim() !== "").length;

  return { edition: "desktop", paid: false, used: Math.min(made, FREE_VIDEOS), limit: FREE_VIDEOS };
}

/** The plan now. Files the app hasn't written yet, or can't be read, count as none. */
export const planStatus = Effect.fn("plan.status")(function* () {
  const dir = yield* DesktopData;

  if (Option.isNone(dir)) return OPEN_SOURCE;
  const ws = yield* Workspace;
  const path = yield* Path.Path;

  const [settings, videos] = yield* Effect.all(
    [
      ws.peekText(path.join(dir.value, "settings.json"), SETTINGS_BYTES).pipe(Effect.option),
      ws
        .peekText(path.join(dir.value, VIDEOS_FILE), VIDEOS_BYTES)
        .pipe(Effect.orElseSucceed(() => "")),
    ],
    { concurrency: "unbounded" },
  );

  return planOf(
    Option.getOrUndefined(settings),
    videos,
    yield* Clock.currentTimeMillis,
    yield* LicensePublicKey,
  );
});

/** A new video refused because the desktop app's free version has made all of its videos. */
export class FreeLimitReached extends Schema.TaggedError<FreeLimitReached>()("FreeLimitReached", {
  message: Schema.String,
}) {}

const LIMIT_MESSAGE =
  `Cutfac's free version has made all ${FREE_VIDEOS} of its videos on this Mac, so it can't start ` +
  "a new one. The videos already made stay editable, variants included, so offer to keep working " +
  `on one of those. To make new videos, the user upgrades at ${PRICING_URL}: while the early-bird ` +
  "offer lasts it is $99/year, and the first 100 buyers keep that price for as long as they stay " +
  "subscribed. After buying, they enter the license key in the Cutfac app (Cutfac menu → License " +
  "Key…). Their workspace files are untouched. This is not a bug in Cutfac, so don't offer to " +
  "report it.";

/**
 * What agent tools add on the free version, so the agent knows how many videos are left before the
 * limit stops it. Undefined on the open-source CLI and a paid plan.
 */
export function freeVersionNote(plan: Plan): string | undefined {
  if (plan.edition === "open-source" || plan.paid) return undefined;
  const used = `Cutfac free version: ${plan.used} of ${plan.limit} videos used on this Mac.`;

  return plan.used < plan.limit
    ? used
    : `${used} New videos need a paid plan (${PRICING_URL}); existing ones stay editable.`;
}

/**
 * Make a new item as `createItem` does, unless the free version has made all of its videos. The
 * desktop app counts every new item, paid or not, so a lapsed plan doesn't bring free ones back.
 * The lock is this process's: the board and each agent's tools run their own, so two of them making
 * the last free video at the same moment can both make it, which errs toward the user.
 */
export const createCountedItem = Effect.fn("plan.createItem")(function* (input: NewItemInput) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const dir = yield* DesktopData;

  if (Option.isNone(dir)) return yield* createItem(input);
  const data = dir.value;

  return yield* ws.exclusive(
    "plan:videos",
    Effect.gen(function* () {
      const plan = yield* planStatus();

      if (plan.edition === "desktop" && !plan.paid && plan.used >= plan.limit) {
        return yield* new FreeLimitReached({ message: LIMIT_MESSAGE });
      }

      const item = yield* createItem(input);

      // The item is made either way; a count that can't be kept lets one video go uncounted.
      yield* appendAppRecord(path.join(data, VIDEOS_FILE), yield* nowIso).pipe(
        Effect.catch((error) => Effect.logWarning(error.message)),
      );

      return item;
    }),
  );
});
