import { Option, Schema } from "effect";

/**
 * The SPA talks to the local Cutfac server. Same-origin by default; a hosted UI can point
 * at a local daemon with ?api=http://localhost:4317 (stored per browser).
 */
const API_BASE = readApiBase();

function readApiBase(): string {
  const fromQuery = new URLSearchParams(location.search).get("api");

  try {
    if (fromQuery !== null) localStorage.setItem("cutfac.api", fromQuery);

    return fromQuery ?? localStorage.getItem("cutfac.api") ?? "";
  } catch {
    return fromQuery ?? "";
  }
}

/** The address of a server path, for a stream or a file the browser loads itself. */
export const apiUrl = (path: string) => `${API_BASE}${path}`;

/**
 * URL of a workspace file. Agents rewrite media under the same name, so pass the file's mtime
 * as `version` to make the browser fetch the new bytes instead of a cached copy.
 */
export function fileUrl(rel: string, version?: number): string {
  const path = rel.split("/").map(encodeURIComponent).join("/");

  return apiUrl(version === undefined ? `/files/${path}` : `/files/${path}?v=${version}`);
}

/** The `?id=` query naming an item. */
export const q = (id: string) => `?id=${encodeURIComponent(id)}`;

/** Every failed /api request answers with this body. */
const ApiFailure = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));

const decodeFailure = Schema.decodeUnknownOption(ApiFailure);

async function failure(res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");

  return Option.match(decodeFailure(body), {
    onSome: ({ error }) => new Error(error),
    onNone: () => new Error(`${res.status} ${res.statusText}`),
  });
}

/** Calls the server and reads its answer as `schema`, which fails the call if it isn't one. */
export async function request<A>(
  schema: Schema.Decoder<A>,
  path: string,
  init?: RequestInit,
): Promise<A> {
  const res = await fetch(apiUrl(path), init);

  if (!res.ok) throw await failure(res);

  return Schema.decodeUnknownPromise(schema)(await res.json(), { errors: "all" });
}

export function send<A, Body>(
  schema: Schema.Decoder<A>,
  method: "POST" | "PATCH",
  path: string,
  body: Body,
): Promise<A> {
  return request(schema, path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A file to upload with its path in what the user dropped: `logo.png`, `photos/a.jpg`. */
export interface Upload {
  file: File;
  path: string;
}

/** A form with the fields that are set and each file next to its path in the drop. */
export function uploadForm(
  uploads: ReadonlyArray<Upload>,
  fields: Record<string, string | undefined> = {},
) {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(name, value);
  }

  for (const { file, path } of uploads) {
    form.append("files", file);
    form.append("paths", path);
  }

  return form;
}

/** The server's plain `{ ok: true }` answer. */
export const Ok = Schema.Struct({ ok: Schema.Literal(true) });
