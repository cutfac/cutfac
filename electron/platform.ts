import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Layer } from "effect";

/**
 * The file system and paths for the main process's Effect code. Bun's layers are Node's own
 * implementation, which Electron runs as well.
 */
export const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
