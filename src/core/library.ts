import { Effect } from "effect";

import { InvalidRequest, NotFound } from "./errors.ts";
import { carriesSecret } from "./links.ts";
import { type MediaFile, toMediaFiles } from "./media.ts";
import { FormatDoc, Product } from "./schema.ts";
import { Workspace, type WorkspaceService, foldersWith, slugify } from "./workspace.ts";

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
  const ids = yield* foldersWith(ws.config.paths.formats, FORMAT_FILE);

  // One unreadable format.yaml shouldn't hide the rest; check_format says what is wrong with it.
  const formats = yield* Effect.forEach(
    ids,
    (id) =>
      getFormat(id).pipe(
        Effect.map((format): Format[] => [format]),
        Effect.catchTag("WorkspaceError", (error) =>
          Effect.as(Effect.logWarning(error.message), []),
        ),
      ),
    { concurrency: 8 },
  );

  return formats.flat();
});

export interface FormatInput extends FormatDoc {
  readonly id?: string | undefined;
}

export const saveFormat = Effect.fn("library.saveFormat")(function* (input: FormatInput) {
  const ws = yield* Workspace;
  const { id: requested, ...doc } = input;
  const id = requested ?? slugify(doc.title);

  if (!isSimpleId(id)) return yield* new InvalidRequest({ message: `Not a format id: ${id}` });

  // format.yaml is shared along with the workspace, so its links must not open anything private.
  const leak = [
    ["source.url", doc.source?.url] as const,
    ...doc.skills.map((skill) => [`the source of skill ${skill.name}`, skill.source] as const),
  ].find(([, link]) => link !== undefined && carriesSecret(link));

  if (leak !== undefined) {
    return yield* new InvalidRequest({
      message: `${leak[0]} carries a password or token; record the link without it`,
    });
  }

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
