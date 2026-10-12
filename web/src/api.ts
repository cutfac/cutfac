/**
 * The SPA talks to the local factory server. Same-origin by default; a hosted UI can point
 * at a local daemon with ?api=http://localhost:4317 (stored per browser).
 */
const API_BASE = (() => {
  const fromQuery = new URLSearchParams(location.search).get("api");
  try {
    if (fromQuery) localStorage.setItem("factory.api", fromQuery);
    return fromQuery ?? localStorage.getItem("factory.api") ?? "";
  } catch {
    return fromQuery ?? "";
  }
})();

export const fileUrl = (rel: string) =>
  `${API_BASE}/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

const q = (id: string) => `?id=${encodeURIComponent(id)}`;
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export type Status =
  | "idea"
  | "drafting"
  | "review"
  | "approved"
  | "scheduled"
  | "published"
  | "archived";
export const STATUSES: Status[] = [
  "idea",
  "drafting",
  "review",
  "approved",
  "scheduled",
  "published",
  "archived",
];

export interface Media {
  name: string;
  kind: "video" | "image";
  aspect?: string;
  size: number;
  mtime: number;
}
export interface Schedule {
  platform: string;
  at: string;
  status: string;
  url?: string;
}
export interface Feedback {
  id: string;
  at: string;
  author: string;
  body: string;
  media?: string;
  timecode?: number;
  status: "open" | "resolved";
  resolution?: string;
}
export interface Metrics {
  platform: string;
  at: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  follows?: number;
  installs?: number;
}
export interface ItemSummary {
  id: string;
  dir: string;
  legacy: boolean;
  title: string;
  status: Status;
  format?: string;
  hook?: string;
  schedule: Schedule[];
  openFeedback: number;
  media: Media[];
  updatedAt: number;
}
export interface ItemDetail {
  id: string;
  dir: string;
  legacy: boolean;
  media: Media[];
  docs: Record<string, string>;
  doc: {
    title: string;
    status: Status;
    format?: string;
    reference?: string;
    hook?: string;
    caption?: string;
    notes?: string;
    platforms: Record<
      string,
      { title?: string; caption?: string; hashtags?: string[]; firstComment?: string }
    >;
    schedule: Schedule[];
    metrics: Metrics[];
    feedback: Feedback[];
  };
}
export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface Reference {
  id: string;
  dir: string;
  doc: {
    title: string;
    source?: string;
    video?: string;
    addedAt: string;
    tags: string[];
    probe?: { duration: number; width: number; height: number; fps: number; hasAudio: boolean };
  };
  analysis?: string;
  preprocess?: {
    cuts: number[];
    frames: { file: string; t: number }[];
    contactSheet?: string;
    notes: string[];
  };
}
export interface Format {
  id: string;
  doc: {
    title: string;
    summary: string;
    references: string[];
    aspects: string[];
    hookRules: string[];
    structure: string[];
  };
}
export interface WorkspaceInfo {
  name: string;
  root: string;
  config: { timezone: string; platforms: string[]; paths: { product: string; items: string } };
  product: {
    doc?: {
      name: string;
      oneLiner: string;
      audience: string;
      cta: { default: string };
      rules: string[];
    };
    captures: Media[];
  };
  formats: Format[];
  openFeedback: number;
}
export interface OpenFeedback {
  item: string;
  title: string;
  feedback: Feedback;
}

export const api = {
  workspace: () => request<WorkspaceInfo>("/api/workspace"),
  items: () => request<ItemSummary[]>("/api/items"),
  item: (id: string) => request<ItemDetail>(`/api/item${q(id)}`),
  updateItem: (
    id: string,
    patch: Partial<{ status: Status; title: string; caption: string; hook: string; notes: string }>,
  ) => request<ItemDetail>(`/api/item${q(id)}`, jsonInit("PATCH", patch)),
  addFeedback: (id: string, body: { body: string; media?: string; timecode?: number }) =>
    request<ItemDetail>(`/api/item/feedback${q(id)}`, jsonInit("POST", body)),
  resolveFeedback: (id: string, feedbackId: string) =>
    request<ItemDetail>(`/api/item/feedback/resolve${q(id)}`, jsonInit("POST", { feedbackId })),
  verify: (id: string) =>
    request<{ file: string; ok: boolean; checks: Check[] }[]>(`/api/item/verify${q(id)}`),
  feedback: () => request<OpenFeedback[]>("/api/feedback"),
  references: () => request<Reference[]>("/api/references"),
  addReferenceUrl: (url: string) =>
    request<Reference>("/api/references", jsonInit("POST", { url })),
  addReferenceFile: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<Reference>("/api/references", { method: "POST", body: form });
  },
};

/** Subscribe to workspace file changes so agent writes appear live. */
export function onWorkspaceChange(listener: () => void): () => void {
  const source = new EventSource(`${API_BASE}/api/events`);
  source.addEventListener("change", listener);
  return () => source.close();
}
