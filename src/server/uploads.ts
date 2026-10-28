import { Effect, Schema } from "effect";
import { HttpServerRequest, Multipart } from "effect/http";

import { InvalidRequest } from "../core/errors.ts";
import type { ReferenceUpload } from "../core/references.ts";

export const MediaForm = Schema.Struct({ file: Multipart.SingleFileSchema });

/** Dropped files and, in the same order, each one's path in the drop: `logo.png`, `photos/a.jpg`. */
export const ReferencesForm = Schema.Struct({
  files: Multipart.FilesSchema,
  paths: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
});

export const isMultipart = (request: HttpServerRequest.HttpServerRequest) =>
  (request.headers["content-type"] ?? "").startsWith("multipart/form-data");

/** What was dropped, each file with its path in the drop: its name unless the form gave paths. */
export const uploadsOf = Effect.fnUntraced(function* (form: typeof ReferencesForm.Type) {
  const given =
    form.paths === undefined ? form.files.map((file) => file.name) : [form.paths].flat();

  if (given.length !== form.files.length) {
    return yield* new InvalidRequest({ message: "Send one path for each file" });
  }

  return form.files.map((file, index): ReferenceUpload => ({
    source: file.path,
    path: given[index] ?? "",
  }));
});
