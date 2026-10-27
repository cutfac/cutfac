import { version } from "../../package.json" with { type: "json" };

/**
 * `bun build --compile` serves every module from Bun's virtual filesystem. Releases ship that
 * binary; anything else runs from source.
 */
export const COMPILED =
  import.meta.path.startsWith("/$bunfs/") || import.meta.path.includes("~BUN");

/** Where the desktop app keeps the binary it bundles, as opposed to the CLI built from source. */
const BUNDLED_BINARY = /\.app\/Contents\/Resources\/bin\/[^/]+$/;

/** Whether this process is the binary the desktop app bundles: its server, or its agent tools. */
export const BUNDLED = COMPILED && BUNDLED_BINARY.test(process.execPath);

/** The app's version, marked `-dev` when it runs from source, so reports from a checkout stand out. */
export const APP_VERSION = COMPILED ? version : `${version}-dev`;
