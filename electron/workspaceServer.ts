import { Option } from "effect";

import { runInMain } from "./runtime.ts";
import { loadPort, savePort } from "./settings.ts";
import { startSidecar, type Sidecar } from "./sidecarRuntime.ts";

export interface WorkspaceServerOptions {
  /** The dev runner's fixed port, which Vite proxies to; the packaged app picks a free one. */
  devPort: number | undefined;
  /** Whether the app is quitting, so a server that just started is stopped again. */
  quitting: () => boolean;
  /** The server stopped on its own, saying why. */
  onCrash: (message: string) => void;
}

/**
 * The local server for the open workspace, one at a time. It may run before the board shows its
 * workspace, as the first launch starts it early; opening that workspace then keeps it.
 */
export function workspaceServer({ devPort, quitting, onCrash }: WorkspaceServerOptions) {
  let sidecar: Sidecar | undefined;
  /** The workspace it runs on. */
  let served: string | undefined;

  const forget = () => {
    sidecar = undefined;
    served = undefined;
  };

  return {
    /** Starts the server on `workspace`, unless it runs on it already. Undefined if quitting. */
    serve: async (workspace: string): Promise<Sidecar | undefined> => {
      if (sidecar !== undefined && served === workspace) return sidecar;

      await sidecar?.stop();
      forget();

      const started = await startSidecar({
        workspace,
        // A fixed dev port held by a stale server fails here instead of passing the health check.
        port:
          devPort === undefined
            ? { last: Option.getOrUndefined(await runInMain(loadPort)) }
            : { fixed: devPort },
        onCrash: (message) => {
          forget();
          onCrash(message);
        },
        watch: devPort !== undefined,
      });

      if (quitting()) {
        await started.stop();

        return undefined;
      }

      sidecar = started;
      served = workspace;

      if (devPort === undefined) await runInMain(savePort(started.port));

      return started;
    },
    stop: async () => {
      const stopping = sidecar;

      forget();
      await stopping?.stop();
    },
    /** Synchronous, for the process-exit hook. */
    kill: () => sidecar?.kill(),
  };
}
