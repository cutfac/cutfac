import { Effect } from "effect";

import { InvalidRequest, NotFound } from "./errors.ts";
import { type MediaFile, toMediaFiles } from "./media.ts";
import { FormatDoc, Product } from "./schema.ts";
import { Workspace, type WorkspaceService, slugify } from "./workspace.ts";

export const FORMAT_FILE = "format.yaml";

export const PRODUCT_FILE = "product.yaml";

const README = "README.md";

export interface Format {
  readonly id: string;
  readonly dir: string;
  readonly doc: FormatDoc;
  readonly readme?: string | undefined;
}

const formatDir = (ws: WorkspaceService, id: string) => `${ws.config.paths.formats}/${id}`;

/** A text file's contents, or `undefined` when it is not there. */
export const readOptionalText = Effect.fn("library.readOptionalText")(function* (rel: string) {
  const ws = yield* Workspace;

  if (!(yield* ws.exists(rel))) return undefined;

  return yield* ws.readText(rel);
});

/** A format id is one folder name under `formats/`. */
export const isSimpleId = (id: string) =>
  id !== "" && id !== "." && id !== ".." && !id.includes("/") && !id.includes("\\");

export const getFormat = Effect.fn("library.getFormat")(function* (id: string) {
  const ws = yield* Workspace;
  const dir = formatDir(ws, id);

  if (!isSimpleId(id) || !(yield* ws.exists(`${dir}/${FORMAT_FILE}`))) {
    return yield* new NotFound({ message: `Format not found: ${id}` });
  }

  const doc = yield* ws.readYaml(`${dir}/${FORMAT_FILE}`, FormatDoc);
  const readme = yield* readOptionalText(`${dir}/${README}`);
  const format: Format = { id, dir, doc, readme };

  return format;
});

export const listFormats = Effect.fn("library.listFormats")(function* () {
  const ws = yield* Workspace;
  const entries = yield* ws.list(ws.config.paths.formats);

  const ids = yield* Effect.filter(
    entries.flatMap((entry) => (entry.dir ? [entry.name] : [])),
    (id) => ws.exists(`${formatDir(ws, id)}/${FORMAT_FILE}`),
    { concurrency: 8 },
  );

  return yield* Effect.forEach(ids, getFormat, { concurrency: 8 });
});

export interface FormatInput extends FormatDoc {
  readonly id?: string | undefined;
}

export const saveFormat = Effect.fn("library.saveFormat")(function* (input: FormatInput) {
  const ws = yield* Workspace;
  const { id: requested, ...doc } = input;
  const id = requested ?? slugify(doc.title);

  if (!isSimpleId(id)) return yield* new InvalidRequest({ message: `Not a format id: ${id}` });
  yield* ws.writeYaml(`${formatDir(ws, id)}/${FORMAT_FILE}`, FormatDoc, doc);

  return yield* getFormat(id);
});

export interface ProductInfo {
  readonly doc?: Product | undefined;
  readonly captures: ReadonlyArray<MediaFile>;
  /** Store icon and screenshots imported from App Store / Google Play (product/store/). */
  readonly store: ReadonlyArray<MediaFile>;
  readonly notes?: string | undefined;
}

export const getProduct = Effect.fn("library.getProduct")(function* () {
  const ws = yield* Workspace;
  const dir = ws.config.paths.product;
  const docFile = `${dir}/${PRODUCT_FILE}`;
  const doc = (yield* ws.exists(docFile)) ? yield* ws.readYaml(docFile, Product) : undefined;

  const info: ProductInfo = {
    doc,
    captures: toMediaFiles(yield* ws.list(`${dir}/captures`)),
    store: toMediaFiles(yield* ws.list(`${dir}/store`)),
    notes: yield* readOptionalText(`${dir}/${README}`),
  };

  return info;
});
