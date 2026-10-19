import { version } from "../../package.json" with { type: "json" };

/**
 * `bun build --compile` serves every module from Bun's virtual filesystem. Releases ship that
 * binary; anything else runs from source.
 */
export const COMPILED =
  import.meta.path.startsWith("/$bunfs/") || import.meta.path.includes("~BUN");

/** The app's version, marked `-dev` when it runs from source, so reports from a checkout stand out. */
export const APP_VERSION = COMPILED ? version : `${version}-dev`;
