import { Context, Effect, Layer, Option, Path, Schema } from "effect";

import { AppData, appendAppRecord } from "./core/appData.ts";
import { BUNDLED, COMPILED } from "./core/build.ts";
import { envVar } from "./core/env.ts";
import { type Item, type NewItemInput, createItem, getItem } from "./core/items.ts";
import { nowIso } from "./core/time.ts";
import { Workspace } from "./core/workspace.ts";
import { paidInSettings } from "./license.ts";

/** How many videos the desktop app's free version makes on one Mac, with every feature open. */
export const FREE_VIDEOS = 3;

/** Where the free version and its agent tools send people. The board keeps its own copy. */
export const PRICING_URL = "https://cutfac.com/pricing";

/** The app's settings file is a few hundred bytes; anything past this isn't one. */
const SETTINGS_BYTES = 64 * 1024;

/** A line per video, far more than a free version or a busy paid one makes. */
const VIDEOS_BYTES = 1024 * 1024;

/**
 * Each video counted on this Mac, paid or not, a line each: `<time> made <key>` for one Cutfac
 * made, `<time> seen <key>` for one first worked on without being made by it, as a folder an
 * agent wrote by hand. `<time> sample <key>` marks one of the app's samples, which never counts.
 * Lines from before keys hold the time alone.
 */
export const VIDEOS_FILE = "videos.log";

/** What names a video in the count. A copy of its folder under another id is another video. */
const videoKey = (item: Item) => `${item.id}@${item.doc.created ?? ""}`;

interface VideoCount {
  readonly made: ReadonlySet<string>;
  readonly seen: ReadonlySet<string>;
  readonly samples: ReadonlySet<string>;
  /** Lines from before keys, which the videos made then and seen since may each stand for. */
  readonly unnamed: number;
}

const countOf = (videos: string): VideoCount => {
  const made = new Set<string>();
  const seen = new Set<string>();
  const samples = new Set<string>();
  let unnamed = 0;

  for (const line of videos.split("\n")) {
    const [time = "", kind, key] = line.trim().split(" ");

    if (kind === "made" && key !== undefined) made.add(key);
    else if (kind === "seen" && key !== undefined) seen.add(key);
    else if (kind === "sample" && key !== undefined) samples.add(key);
    else if (time !== "") unnamed++;
  }

  return { made, seen, samples, unnamed };
};

const usedOf = ({ made, seen, unnamed }: VideoCount) => made.size + Math.max(unnamed, seen.size);

/** Whether work on the video needs no new count: it is counted already, or is a sample. */
const isCounted = ({ made, seen, samples }: VideoCount, key: string) =>
  made.has(key) || seen.has(key) || samples.has(key);

/**
 * The desktop app's data folder, which holds its license and the count of videos made, when this
 * process belongs to the desktop app. None for the open-source CLI, which has no limit.
 */
export const DesktopData = Context.Reference<Option.Option<string>>("cutfac/DesktopData", {
  defaultValue: () => Option.none(),
});

/**
 * The app's folder in Application Support when this is the binary the desktop app bundles. From
 * source, CUTFAC_DESKTOP_DATA names a folder to try the free version with.
 */
export const desktopData = Layer.effect(
  DesktopData,
  Effect.gen(function* () {
    if (!BUNDLED) return yield* envVar("CUTFAC_DESKTOP_DATA");
    const path = yield* Path.Path;

    return Option.map(yield* envVar("HOME"), (home) =>
      path.join(home, "Library", "Application Support", "Cutfac"),
    );
  }),
);

/**
 * Where the app keeps its own records: the desktop app's data folder, or, for the CLI, the folder
 * the desktop app uses on this platform, so the two agree on which workspaces the user trusts; run
 * from source, the dev build's.
 */
export const appData = Layer.effect(
  AppData,
  Effect.gen(function* () {
    const desktop = yield* DesktopData;

    if (Option.isSome(desktop)) return desktop;
    const path = yield* Path.Path;
    const home = yield* envVar("HOME");
    // Run from source, it is the dev build's, so a checkout never writes into the released app's.
    const folder = COMPILED ? "Cutfac" : "Cutfac Dev";

    if (process.platform === "win32") {
      return Option.map(yield* envVar("APPDATA"), (dir) => path.join(dir, folder));
    }

    if (process.platform === "darwin") {
      return Option.map(home, (dir) => path.join(dir, "Library", "Application Support", folder));
    }

    const config = Option.orElse(yield* envVar("XDG_CONFIG_HOME"), () =>
      Option.map(home, (dir) => path.join(dir, ".config")),
    );

    return Option.map(config, (dir) => path.join(dir, folder));
  }),
).pipe(Layer.provideMerge(desktopData));

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

/** What the desktop app's settings and video count say about the plan now. */
export const planOf = Effect.fnUntraced(function* (
  settings: Option.Option<string>,
  videos: string,
): Effect.fn.Return<Plan> {
  if (Option.isSome(settings) && (yield* paidInSettings(settings.value))) return PAID;

  const used = usedOf(countOf(videos));

  return { edition: "desktop", paid: false, used: Math.min(used, FREE_VIDEOS), limit: FREE_VIDEOS };
});

/** The app's settings and video count in `dir`. Files it hasn't written yet, or can't be read, are empty. */
const readRecords = Effect.fnUntraced(function* (dir: string) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;

  return yield* Effect.all(
    [
      ws.peekText(path.join(dir, "settings.json"), SETTINGS_BYTES).pipe(Effect.option),
      ws.peekText(path.join(dir, VIDEOS_FILE), VIDEOS_BYTES).pipe(Effect.orElseSucceed(() => "")),
    ],
    { concurrency: "unbounded" },
  );
});

/** The plan now. */
export const planStatus = Effect.fn("plan.status")(function* () {
  const dir = yield* DesktopData;

  if (Option.isNone(dir)) return OPEN_SOURCE;

  return yield* planOf(...(yield* readRecords(dir.value)));
});

/** Adds a line to the count. The work goes on either way; a count that can't be kept lets one go. */
const record = Effect.fnUntraced(function* (
  dir: string,
  kind: "made" | "seen" | "sample",
  key: string,
) {
  const path = yield* Path.Path;

  yield* appendAppRecord(path.join(dir, VIDEOS_FILE), `${yield* nowIso} ${kind} ${key}`).pipe(
    Effect.catch((error) => Effect.logWarning(error.message)),
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
  "Key…). Their workspace files are untouched. Don't make a video's folder or item.yaml yourself " +
  "instead: Cutfac counts a video it didn't make when work on it starts. This is not a bug in " +
  "Cutfac, so don't offer to report it.";

const UNCOUNTED_MESSAGE =
  "This video wasn't made by create_item or the board, so it isn't one of the videos Cutfac's " +
  `free version made. ${LIMIT_MESSAGE}`;

/** Brings the paid plan up once, when the user would think of it, rather than in every reply. */
const MENTION_ONCE =
  "Say so to the user once, in a sentence, when a video is done or they ask for a new one; " +
  "don't bring it up again.";

export function freeVersionNote(plan: Plan): Option.Option<string> {
  if (plan.edition === "open-source" || plan.paid) return Option.none();
  const used = `Cutfac free version: ${plan.used} of ${plan.limit} videos used on this Mac.`;

  if (plan.used >= plan.limit) {
    return Option.some(
      `${used} New videos need a paid plan (${PRICING_URL}); existing ones stay editable. ${MENTION_ONCE}`,
    );
  }

  if (plan.used === plan.limit - 1) {
    return Option.some(
      `${used} One free video is left; more need a paid plan (${PRICING_URL}). ${MENTION_ONCE}`,
    );
  }

  return Option.some(used);
}

/**
 * Make a new item as `createItem` does, unless the free version has made all of its videos. The
 * desktop app counts every new item, paid or not, so a lapsed plan doesn't bring free ones back.
 * The lock is this process's: the board and each agent's tools run their own, so two of them making
 * the last free video at the same moment can both make it, which errs toward the user.
 */
export const createCountedItem = Effect.fn("plan.createItem")(function* (input: NewItemInput) {
  return yield* createWithin(input, "now");
});

/**
 * Make an item with nothing asked of it yet, such as the empty editor the first launch opens on.
 * It counts once work on it starts, as {@link workOn} counts one Cutfac didn't make, so an editor
 * left empty costs no free video; past the limit it is refused as a counted one would be.
 */
export const createEmptyItem = Effect.fn("plan.createEmptyItem")(function* (input: NewItemInput) {
  return yield* createWithin(input, "onWork");
});

const createWithin = Effect.fnUntraced(function* (input: NewItemInput, counted: "now" | "onWork") {
  const ws = yield* Workspace;
  const dir = yield* DesktopData;

  if (Option.isNone(dir)) return yield* createItem(input);
  const data = dir.value;

  return yield* ws.exclusive(
    "plan:videos",
    Effect.gen(function* () {
      if (atFreeLimit(yield* planOf(...(yield* readRecords(data))))) {
        return yield* new FreeLimitReached({ message: LIMIT_MESSAGE });
      }

      const item = yield* createItem(input);

      if (counted === "now") yield* record(data, "made", videoKey(item));

      return item;
    }),
  );
});

/**
 * Marks `item` as one of the app's samples, which work on never counts as a video. Kept in the
 * app's data rather than the item, so a folder can't be made one by editing it.
 */
export const markSample = Effect.fn("plan.markSample")(function* (item: Item) {
  const dir = yield* DesktopData;

  if (Option.isSome(dir)) yield* record(dir.value, "sample", videoKey(item));
});

const atFreeLimit = (plan: Plan) =>
  plan.edition === "desktop" && !plan.paid && plan.used >= plan.limit;

/**
 * Lets work start on the video `id`: an agent's edit, render or new version. One Cutfac didn't
 * make, as a folder an agent wrote by hand, counts as a new video now, and the free version
 * refuses it once it has made all of its videos.
 */
export const workOn = Effect.fn("plan.workOn")(function* (id: string) {
  const ws = yield* Workspace;
  const dir = yield* DesktopData;

  if (Option.isNone(dir)) return;
  const data = dir.value;
  const key = videoKey(yield* getItem(id));

  yield* ws.exclusive(
    "plan:videos",
    Effect.gen(function* () {
      const [settings, videos] = yield* readRecords(data);

      if (isCounted(countOf(videos), key)) return;

      if (atFreeLimit(yield* planOf(settings, videos))) {
        return yield* new FreeLimitReached({ message: UNCOUNTED_MESSAGE });
      }

      yield* record(data, "seen", key);
    }),
  );
});
