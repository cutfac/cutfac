import { Effect } from "effect";

import { shortId } from "./items.ts";
import { extension } from "./media.ts";
import { downloadVideo } from "./preprocess.ts";
import { addReferences, type ReferenceFolder } from "./references.ts";
import { cleanUrl } from "./sources.ts";
import { Workspace, slugify } from "./workspace.ts";

/** Longest file name taken from a video's title, before its extension. */
const MAX_NAME = 60;

/** A file name from a video's title, such as `how-to-cook-rice`, or `video` without one. */
function nameFrom(title: string | undefined): string {
  const slug = slugify(title ?? "")
    .slice(0, MAX_NAME)
    .replace(/-+$/, "");

  return slug === "" ? "video" : slug;
}

/**
 * Download a video link with yt-dlp into a references folder, named after the video's title, the
 * way a file the user dropped is kept. It downloads into a hidden folder beside the references,
 * so a half-done download never shows as one. Returns the added path, such as
 * `references/how-to-cook-rice.mp4`. A link that carries a login is refused before it is fetched.
 */
export const addLinkedVideo = Effect.fn("linkedVideos.addLinkedVideo")(function* (
  folder: ReferenceFolder,
  url: string,
) {
  const ws = yield* Workspace;
  const link = yield* cleanUrl(url);
  const temp = `${folder.owner}/.downloads/${yield* shortId}`;

  yield* ws.mkdir(temp);

  return yield* Effect.gen(function* () {
    const downloaded = yield* downloadVideo(link, temp);
    const name = `${nameFrom(downloaded.title)}.${extension(downloaded.video)}`;
    const source = yield* ws.abs(`${temp}/${downloaded.video}`);
    const [added = ""] = yield* addReferences(folder, [{ source, path: name }]);

    return added;
  }).pipe(Effect.ensuring(ws.remove(temp).pipe(Effect.ignore)));
});
