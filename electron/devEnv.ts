import { Config, Effect, Option } from "effect";

/** What `bun run desktop:dev` launches the app with, set in `electron/dev.ts`. */
export const DEV_ENV = {
  url: "CUTFAC_DEV_URL",
  serverPort: "CUTFAC_PORT",
  restart: "CUTFAC_DEV_RESTART",
} as const;

const DevLaunchConfig = Config.all({
  /** Vite's board, loaded instead of the app's own copy, with the server on the port it proxies to. */
  url: Config.NonEmptyString(DEV_ENV.url),
  serverPort: Config.Port(DEV_ENV.serverPort).pipe(Config.withDefault(4317)),
  /** The runner restarted the app for a change: it comes back behind what the developer works in. */
  restart: Config.Boolean(DEV_ENV.restart).pipe(Config.withDefault(false)),
});

export type DevLaunch = Config.Success<typeof DevLaunchConfig>;

export const devLaunchOf = Config.option(DevLaunchConfig).pipe(
  Effect.orElseSucceed(Option.none<DevLaunch>),
);
