import { useEffect, useState } from "react";

import { api, type Media } from "../api.ts";

/** Until the server has read the file, a frame is taken as 1/30 s, the rate renders use most. */
const ASSUMED_FPS = 30;

/** The shown video's frame rate, read again when an agent's render rewrites the file. */
export function useFrameRate(id: string, media: Media | undefined): number {
  const [read, setRead] = useState<{ key: string; fps: number } | undefined>(undefined);
  const name = media?.kind === "video" ? media.name : undefined;
  const key = name === undefined ? undefined : `${name}:${media?.mtime ?? 0}`;

  useEffect(() => {
    if (name === undefined || key === undefined) return;

    let current = true;

    api.frameRate(id, name).then(
      ({ fps }) => {
        if (current && fps > 0) setRead({ key, fps });
      },
      () => undefined,
    );

    return () => {
      current = false;
    };
  }, [id, name, key]);

  return read !== undefined && read.key === key ? read.fps : ASSUMED_FPS;
}
