import { Option, Schema } from "effect";

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

export const apiUrl = (path: string) => `${API_BASE}${path}`;

export function fileUrl(rel: string, version?: number): string {
  const path = rel.split("/").map(encodeURIComponent).join("/");

  return apiUrl(version === undefined ? `/files/${path}` : `/files/${path}?v=${version}`);
}

export const q = (id: string) => `?id=${encodeURIComponent(id)}`;

const ApiFailure = Schema.fromJsonString(Schema.Struct({ error: Schema.String }));

const decodeFailure = Schema.decodeUnknownOption(ApiFailure);

async function failure(res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");

  return Option.match(decodeFailure(body), {
    onSome: ({ error }) => new Error(error),
    onNone: () => new Error(`${res.status} ${res.statusText}`),
  });
}

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

export interface Upload {
  file: File;
  path: string;
}

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

export const Ok = Schema.Struct({ ok: Schema.Literal(true) });
