import type { AgentChoice, AgentName, AgentStatus, ImportDetail, ImportTurn } from "../api.ts";
import { runView, type LiveRun, type RunView } from "./run.ts";

/** Imports open on the Templates page under this prefix, as `#/templates/import/<id>`. */
const IMPORT_PREFIX = "import/";

/** The templates route id that opens an import. */
export const importRouteId = (id: string) => `${IMPORT_PREFIX}${id}`;

/** The import a templates route id opens, if it opens one. */
export const importIdOf = (routeId: string | undefined) =>
  routeId?.startsWith(IMPORT_PREFIX) ? routeId.slice(IMPORT_PREFIX.length) : undefined;

/**
 * Reading and installing: the agent is working, before and after the user allowed installs.
 * Waiting: it read the link and waits for the user to answer or allow. Done: it finished after
 * installs were allowed.
 */
export type ImportState =
  | "reading"
  | "waiting"
  | "installing"
  | "done"
  | "failed"
  | "stopped"
  | "closed";

/** A turn's run: the streamed one while it is about this turn, else the saved one. */
export function turnRun(detail: ImportDetail, turn: ImportTurn, live: LiveRun): RunView {
  // Only the last turn can have an agent on it; an earlier one still marked running was cut off.
  const alive = detail.running && detail.doc.turns.at(-1)?.id === turn.id;

  return runView(turn.run, live.subject === turn.id ? live : undefined, alive);
}

/** Where the import stands, from its last turn's run. */
export function importState(detail: ImportDetail, live: LiveRun): ImportState {
  const { doc } = detail;

  if (doc.closed) return "closed";

  const last = doc.turns.at(-1);

  // Turns are recorded before their run starts, so one without any did not get going.
  if (last === undefined) return "failed";

  switch (turnRun(detail, last, live).status) {
    case "running":
      return doc.allowed ? "installing" : "reading";
    case "done":
      return doc.allowed ? "done" : "waiting";
    case "failed":
      return "failed";
    default:
      return "stopped";
  }
}

/** Whether an agent is on the import, so it takes no message until it is done or stopped. */
export const isWorking = (state: ImportState) => state === "reading" || state === "installing";

/** The link as a row names it: host and path, without the scheme, `www.`, or a trailing slash. */
export function linkLabel(link: string): string {
  try {
    const { host, pathname } = new URL(link);

    return `${host.replace(/^www\./, "")}${pathname.replace(/\/+$/, "")}`;
  } catch {
    return link;
  }
}

/**
 * The agent an import starts with: the workspace default when it is installed, else the first one
 * that is, or none when no agent is. Until the list loads the default stands, and the server says
 * so if it cannot start. Copying the prompt is not a choice here; the dialog offers it beside.
 */
export function importAgent(
  preferred: AgentChoice | undefined,
  statuses: ReadonlyArray<AgentStatus> | undefined,
): AgentName | undefined {
  const wanted = preferred === "queue" ? undefined : preferred;

  if (statuses === undefined) return wanted ?? "claude";

  const installed = statuses.flatMap((status) => (status.installed ? [status.agent] : []));

  return wanted !== undefined && installed.includes(wanted) ? wanted : installed[0];
}
