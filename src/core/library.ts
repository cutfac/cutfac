import { FormatDoc, Product } from "./schema.ts";
import { type Workspace, slugify } from "./workspace.ts";
import { toMediaFiles, type MediaFile } from "./media.ts";

export const FORMAT_FILE = "format.yaml";
export const PRODUCT_FILE = "product.yaml";

export interface Format {
  id: string;
  dir: string;
  doc: FormatDoc;
  readme?: string;
}

const formatDir = (ws: Workspace, id: string) => `${ws.config.paths.formats}/${id}`;

export async function listFormats(ws: Workspace): Promise<Format[]> {
  const entries = await ws.list(ws.config.paths.formats);
  const ids = entries
    .filter((e) => e.dir && ws.exists(`${formatDir(ws, e.name)}/${FORMAT_FILE}`))
    .map((e) => e.name);
  return Promise.all(ids.map((id) => getFormat(ws, id)));
}

export async function getFormat(ws: Workspace, id: string): Promise<Format> {
  const dir = formatDir(ws, id);
  const doc = await ws.readYaml(`${dir}/${FORMAT_FILE}`, FormatDoc);
  const format: Format = { id, dir, doc };
  if (ws.exists(`${dir}/README.md`)) format.readme = await ws.readText(`${dir}/README.md`);
  return format;
}

export async function saveFormat(
  ws: Workspace,
  input: { id?: string | undefined } & FormatDoc,
): Promise<Format> {
  const { id: requested, ...rest } = input;
  const id = requested ?? slugify(rest.title);
  await ws.writeYaml(`${formatDir(ws, id)}/${FORMAT_FILE}`, FormatDoc.parse(rest));
  return getFormat(ws, id);
}

export interface ProductInfo {
  doc?: Product;
  captures: MediaFile[];
  notes?: string;
}

export async function getProduct(ws: Workspace): Promise<ProductInfo> {
  const dir = ws.config.paths.product;
  const info: ProductInfo = { captures: toMediaFiles(await ws.list(`${dir}/captures`)) };
  if (ws.exists(`${dir}/${PRODUCT_FILE}`))
    info.doc = await ws.readYaml(`${dir}/${PRODUCT_FILE}`, Product);
  if (ws.exists(`${dir}/README.md`)) info.notes = await ws.readText(`${dir}/README.md`);
  return info;
}
