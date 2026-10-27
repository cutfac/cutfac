import { dirname, join } from "node:path";

import { Effect, FileSystem, Predicate, type Schema } from "effect";

/** Files by their path in a folder: text as it is, anything else as JSON. */
export type Files = Readonly<Record<string, Schema.Json>>;

export const writeFiles = (root: string, files: Files) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (const [file, content] of Object.entries(files)) {
      const full = join(root, file);

      yield* fs.makeDirectory(dirname(full), { recursive: true });
      yield* fs.writeFileString(
        full,
        Predicate.isString(content) ? content : JSON.stringify(content),
      );
    }
  }).pipe(Effect.orDie);

/** Where an agent keeps version `version` of the plugin `id`, under its config folder `config`. */
export function pluginFolder(config: string, id: string, version = "1.0.0") {
  const [name = id, market = ""] = id.split("@");

  return join(config, "plugins", "cache", market, name, version);
}

export interface ClaudePluginSetup {
  readonly files: Files;
  /** The one folder it's installed for; every folder when left out. */
  readonly projectPath?: string;
}

/**
 * Claude Code's plugins installed as `plugins` says and turned on or off in the user's settings as
 * `enabled` says, in Claude Code's config folder `config`.
 */
export const setUpClaudePlugins = Effect.fnUntraced(function* (
  config: string,
  plugins: Readonly<Record<string, ClaudePluginSetup>>,
  enabled: Readonly<Record<string, boolean>>,
) {
  const installed = Object.fromEntries(
    Object.entries(plugins).map(([id, { projectPath }]) => {
      const install = { installPath: pluginFolder(config, id), version: "1.0.0" };

      return [
        id,
        [
          projectPath === undefined
            ? { ...install, scope: "user" }
            : { ...install, scope: "local", projectPath },
        ],
      ];
    }),
  );

  yield* writeFiles(config, {
    "settings.json": { enabledPlugins: enabled },
    "plugins/installed_plugins.json": { version: 2, plugins: installed },
  });

  for (const [id, { files }] of Object.entries(plugins)) {
    yield* writeFiles(pluginFolder(config, id), files);
  }
});
