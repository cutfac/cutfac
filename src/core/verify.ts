import { getItem } from "./items.ts";
import { getFormat } from "./library.ts";
import { type Check, checkVideo, probe } from "./media.ts";
import type { FormatDoc } from "./schema.ts";
import type { Workspace } from "./workspace.ts";

export interface MediaReport {
  file: string;
  checks: Check[];
  ok: boolean;
}

/** ffprobe every video in an item and check it against upload rules and the item's format. */
export async function verifyItem(ws: Workspace, id: string): Promise<MediaReport[]> {
  const item = await getItem(ws, id);
  let format: FormatDoc | undefined;
  if (item.doc.format && ws.exists(`${ws.config.paths.formats}/${item.doc.format}`)) {
    format = (await getFormat(ws, item.doc.format)).doc;
  }
  const reports: MediaReport[] = [];
  for (const m of item.media.filter((m) => m.kind === "video")) {
    const p = await probe(ws.abs(`${item.dir}/${m.name}`));
    const checks = checkVideo(p, {
      ...(m.aspect ? { aspect: m.aspect } : {}),
      ...(format ? { format } : {}),
    });
    reports.push({ file: m.name, checks, ok: checks.every((c) => c.ok) });
  }
  return reports;
}
