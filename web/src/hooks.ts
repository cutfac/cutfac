import { useCallback, useEffect, useState } from "react";
import { onWorkspaceChange } from "./api.ts";

/** Load data and reload whenever the workspace changes on disk (agent writes show up live). */
export function useLive<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    load()
      .then((value) => {
        setData(value);
        setError(undefined);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, deps);
  useEffect(() => {
    reload();
    return onWorkspaceChange(reload);
  }, [reload]);
  return { data, error, reload, setData };
}

export function useHashRoute(): [string, string | undefined] {
  const read = () => {
    const [view = "board", ...rest] = location.hash.replace(/^#\/?/, "").split("/");
    const id = rest.length ? decodeURIComponent(rest.join("/")) : undefined;
    return [view || "board", id] as [string, string | undefined];
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export const href = (view: string, id?: string) =>
  `#/${view}${id ? `/${encodeURIComponent(id)}` : ""}`;

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}
