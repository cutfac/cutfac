import { Effect } from "effect";

import { getItem } from "./items.ts";
import { FORMAT_FILE, getFormat, isSimpleId } from "./library.ts";
import { type Check, checkVideo, probe } from "./media.ts";
import { Workspace } from "./workspace.ts";

export interface MediaReport {
  readonly file: string;
  readonly checks: ReadonlyArray<Check>;
  readonly ok: boolean;
}

/** The item's format recipe, when it names one that exists. */
const itemFormat = Effect.fnUntraced(function* (formatId: string | undefined) {
  const ws = yield* Workspace;

  if (formatId === undefined || !isSimpleId(formatId)) return undefined;
  const exists = yield* ws.exists(`${ws.config.paths.formats}/${formatId}/${FORMAT_FILE}`);

  return exists ? (yield* getFormat(formatId)).doc : undefined;
});

/** ffprobe every video in an item and check it against upload rules and the item's format. */
export const verifyItem = Effect.fn("verify.verifyItem")(function* (id: string) {
  const ws = yield* Workspace;
  const item = yield* getItem(id);
  const format = yield* itemFormat(item.doc.format);
  const videos = item.media.filter((media) => media.kind === "video");

  return yield* Effect.forEach(
    videos,
    Effect.fnUntraced(function* (media) {
      const probed = yield* probe(yield* ws.abs(`${item.dir}/${media.name}`));
      const checks = checkVideo(probed, { aspect: media.aspect, format });
      const report: MediaReport = { file: media.name, checks, ok: checks.every((c) => c.ok) };

      return report;
    }),
    { concurrency: 2 },
  );
});
