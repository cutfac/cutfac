import { request, send } from "./api.ts";
import { BriefView, type BriefPatch } from "./lib/brief.ts";

/** The workspace's brief.md, which the agent reads before every template and video. */
export const briefApi = {
  brief: () => request(BriefView, "/api/brief"),
  updateBrief: (patch: BriefPatch) => send(BriefView, "PATCH", "/api/brief", patch),
};
