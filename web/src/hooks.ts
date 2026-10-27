import { useEffect, useEffectEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  api,
  onWorkspaceChange,
  type AgentName,
  type AgentStatus,
  type ModelSettings,
  type Plan,
} from "./api.ts";
import { desktop } from "./desktop.ts";
import type { ModelPicks } from "./lib/models.ts";

interface Loaded<T> {
  key: string;
  /** Which reload produced this, so a reload refetches even for the same key. */
  version: number;
  data?: T;
  error?: string;
}

export interface Live<T> {
  data: T | undefined;
  error: string | undefined;
  reload: () => void;
  /** Show a server response right away instead of waiting for the change event. */
  setData: (data: T) => void;
}

const messageOf = (cause: Error | string) => (cause instanceof Error ? cause.message : cause);

/**
 * Load data for `key` and reload whenever the workspace changes on disk, so agent writes show
 * up without a refresh. A new key drops the previous key's data instead of showing it stale.
 */
export function useLive<T>(key: string, load: () => Promise<T>): Live<T> {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T>>({ key, version });
  const fetchData = useEffectEvent(load);

  useEffect(() => onWorkspaceChange(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    let current = true;
    fetchData().then(
      (data) => {
        if (current) setLoaded({ key, version, data });
      },
      (cause: Error) => {
        if (!current) return;

        // A failed reload keeps what this key last showed; another key's data never carries over.
        setLoaded((prev) => {
          const next: Loaded<T> = { key, version, error: messageOf(cause) };

          if (prev.key === key && prev.data !== undefined) next.data = prev.data;

          return next;
        });
      },
    );

    return () => {
      current = false;
    };
  }, [key, version]);

  const fresh = loaded.key === key;

  return {
    data: fresh ? loaded.data : undefined,
    error: fresh ? loaded.error : undefined,
    reload: () => setVersion((v) => v + 1),
    setData: (data) => setLoaded({ key, version, data }),
  };
}

/**
 * The plan, reloaded as the workspace changes, which is when a new video counts, and as the desktop
 * app hears back about its license key.
 */
export function usePlan(): Live<Plan> {
  const plan = useLive("plan", api.plan);
  const reload = useEffectEvent(plan.reload);

  useEffect(() => desktop?.onLicenseChange(() => reload()), []);

  return plan;
}

/**
 * Which agents are installed, loaded once per mount: that changes only when the user installs one.
 * Undefined until it loads or when it fails; then every agent stays selectable, and the server
 * says why when one cannot start.
 */
export function useAgentStatuses(): ReadonlyArray<AgentStatus> | undefined {
  const [statuses, setStatuses] = useState<ReadonlyArray<AgentStatus>>();

  useEffect(() => {
    let alive = true;
    api.agents().then(
      (list) => {
        if (alive) setStatuses(list);
      },
      () => undefined,
    );

    return () => {
      alive = false;
    };
  }, []);

  return statuses;
}

/** Whether the user can pick an agent: it is installed, or the list has not said otherwise. */
export const agentInstalled = (
  statuses: ReadonlyArray<AgentStatus> | undefined,
  agent: AgentStatus["agent"],
) =>
  statuses === undefined || statuses.some((status) => status.agent === agent && status.installed);

type Route = readonly [view: string, id: string | undefined];

function readRoute(): Route {
  const [view = "", ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  const id = rest.length > 0 ? decodeURIComponent(rest.join("/")) : undefined;

  return [view === "" ? "board" : view, id];
}

/** Which way the page zooms when the route changes: into a video from the gallery, or back out. */
function zoomOf(from: Route, to: Route) {
  if (from[0] === "board" && to[0] === "item") return "zoom-in";

  return from[0] === "item" && to[0] === "board" ? "zoom-out" : undefined;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  const current = useRef(route);
  useEffect(() => {
    const onHash = () => {
      const next = readRoute();
      const zoom = zoomOf(current.current, next);
      current.current = next;

      if (zoom === undefined || document.startViewTransition === undefined) {
        setRoute(next);

        return;
      }

      // The new page must be in the DOM when the browser takes its picture of it.
      document.startViewTransition({
        update: () => flushSync(() => setRoute(next)),
        types: [zoom],
      });
    };

    addEventListener("hashchange", onHash);

    return () => removeEventListener("hashchange", onHash);
  }, []);

  return route;
}

export const href = (view: string, id?: string) =>
  id === undefined ? `#/${view}` : `#/${view}/${encodeURIComponent(id)}`;

/** Where this browser keeps one part of an agent's pick, such as `cutfac.model.claude`. */
const pickKey = (agent: AgentName, part: keyof ModelSettings) => `cutfac.${part}.${agent}`;

function readPick(agent: AgentName): ModelSettings {
  const settings: ModelSettings = {};

  try {
    for (const part of ["model", "effort"] as const) {
      const value = localStorage.getItem(pickKey(agent, part));

      if (value !== null && value !== "") settings[part] = value;
    }
  } catch {
    // Storage can be blocked; the agent starts on its own default.
  }

  return settings;
}

/**
 * The model and effort picked for each agent, kept in this browser so the next request starts
 * where the last one left off. What the agent no longer offers is dropped where it is sent.
 */
export function useModelPicks() {
  const [picks, setPicks] = useState((): ModelPicks => ({
    claude: readPick("claude"),
    codex: readPick("codex"),
  }));

  const pick = (agent: AgentName, settings: ModelSettings) => {
    setPicks({ ...picks, [agent]: settings });

    try {
      for (const part of ["model", "effort"] as const) {
        const value = settings[part];

        if (value === undefined) localStorage.removeItem(pickKey(agent, part));
        else localStorage.setItem(pickKey(agent, part), value);
      }
    } catch {
      // The pick just won't survive a reload.
    }
  };

  return [picks, pick] as const;
}

const SIDEBAR_OPEN_KEY = "cutfac.sidebar.open";

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_OPEN_KEY) !== "false";
  } catch {
    // Storage can be blocked (private windows, cleared site data); start expanded.
    return true;
  }
}

function writeSidebarOpen(open: boolean) {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, String(open));
  } catch {
    // The choice just won't survive a reload.
  }
}

type SidebarOpen = readonly [open: boolean, setOpen: (open: boolean) => void];

/** Whether the sidebar is open: the user's saved choice, the same on every page. */
export function useSidebarOpen(): SidebarOpen {
  const [open, setOpen] = useState(readSidebarOpen);

  return [
    open,
    (next) => {
      setOpen(next);
      writeSidebarOpen(next);
    },
  ];
}

/** The sidebar's width in pixels when nobody has dragged it: the sidebar's own 14rem. */
export const SIDEBAR_WIDTH = 224;

const SIDEBAR_MIN_WIDTH = 192;

const SIDEBAR_MAX_WIDTH = 400;

const SIDEBAR_WIDTH_KEY = "cutfac.sidebar.width";

/** A width the sidebar can take, whole pixels between the narrowest and the widest. */
export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

function readSidebarWidth(): number {
  try {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));

    return saved > 0 ? clampSidebarWidth(saved) : SIDEBAR_WIDTH;
  } catch {
    return SIDEBAR_WIDTH;
  }
}

/** The sidebar's width: what the user dragged it to, the same on every page. */
export function useSidebarWidth(): readonly [width: number, setWidth: (width: number) => void] {
  const [width, setWidth] = useState(readSidebarWidth);

  return [
    width,
    (next) => {
      setWidth(next);

      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
      } catch {
        // The width just won't survive a reload.
      }
    },
  ];
}
