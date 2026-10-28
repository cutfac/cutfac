import { Effect, Option } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { InvalidRequest } from "../core/errors.ts";
import { extension } from "../core/media.ts";
import { Workspace } from "../core/workspace.ts";
import { raw } from "./respond.ts";

/** Workspace files the board may load, by extension, with the type to serve them as. */
const SERVABLE = new Map([
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["md", "text/markdown; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["srt", "text/plain; charset=utf-8"],
  ["vtt", "text/vtt; charset=utf-8"],
  ["wav", "audio/wav"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
]);

const FILES_PREFIX = "/files/";

export type ByteRange =
  | { readonly kind: "whole" }
  | { readonly kind: "slice"; readonly start: number; readonly end: number }
  | { readonly kind: "unsatisfiable" };

/**
 * One `Range: bytes=…` header against a file of `size` bytes. `end` is inclusive. Headers this
 * does not understand, such as multiple ranges, get the whole file, as HTTP allows.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  const from = match?.[1] ?? "";
  const to = match?.[2] ?? "";

  if (from === "" && to === "") return { kind: "whole" };

  const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);

  if (start > end || (from === "" && Number(to) === 0)) return { kind: "unsatisfiable" };

  return { kind: "slice", start, end };
}

const decodePath = (encoded: string) =>
  Effect.try({
    try: () => decodeURIComponent(encoded),
    catch: () => new InvalidRequest({ message: "Malformed file path" }),
  });

/** A workspace file, with byte ranges so the board can scrub video. */
const fileRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);

  const pathname = Option.match(url, {
    onNone: () => request.url,
    onSome: (value) => value.pathname,
  });

  const rel = yield* decodePath(pathname.slice(FILES_PREFIX.length));
  const contentType = SERVABLE.get(extension(rel));

  if (contentType === undefined) return HttpServerResponse.text("Not servable", { status: 403 });

  const resolved = yield* Effect.option(ws.abs(rel));

  if (Option.isNone(resolved))
    return HttpServerResponse.text("Outside the workspace", { status: 403 });

  if (!(yield* ws.exists(rel))) return HttpServerResponse.text("Not found", { status: 404 });

  const { size } = yield* ws.stat(rel);
  const range = parseRange(request.headers["range"], size);
  const headers = { "accept-ranges": "bytes", "cache-control": "no-cache" };

  switch (range.kind) {
    case "whole":
      return yield* HttpServerResponse.file(resolved.value, { contentType, headers });
    case "slice":
      return yield* HttpServerResponse.file(resolved.value, {
        contentType,
        status: 206,
        offset: range.start,
        bytesToRead: range.end - range.start + 1,
        headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}` },
      });
    case "unsatisfiable":
      return HttpServerResponse.empty({
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
  }
});

export const fileRoutes = HttpRouter.addAll([raw("GET", `${FILES_PREFIX}*`, fileRoute)]);
