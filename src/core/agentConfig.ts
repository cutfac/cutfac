import { Config, Effect, Option, Path, Schema } from "effect";

import { claudeModelName, codexConfigModel } from "./models.ts";
import { Workspace } from "./workspace.ts";

/** Enough of a settings or config file to find the model in it. */
const SETTINGS_BYTES = 1024 * 1024;

const ModelSetting = Schema.fromJsonString(
  Schema.Struct({ model: Schema.optional(Schema.String) }),
);

const decodeModelSetting = Schema.decodeUnknownOption(ModelSetting);

/** The environment variable `name`, or none. */
export const envVar = (name: string) =>
  Config.option(Config.String(name)).pipe(Effect.orElseSucceed(Option.none));

/** A file outside the workspace, or nothing when it is missing or unreadable. */
const peek = (full: string) =>
  Effect.flatMap(Workspace, (ws) => ws.peekText(full, SETTINGS_BYTES)).pipe(Effect.option);

/** Codex's own folder, which holds the user's `config.toml`. */
export const codexHome = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* envVar("HOME");

  return Option.orElse(yield* envVar("CODEX_HOME"), () =>
    Option.map(home, (dir) => path.join(dir, ".codex")),
  );
});

/** Claude Code's own folder, which holds the user's settings and plugins. */
export const claudeConfigDir = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* envVar("HOME");

  return Option.orElse(yield* envVar("CLAUDE_CONFIG_DIR"), () =>
    Option.map(home, (dir) => path.join(dir, ".claude")),
  );
});

/** Claude Code's settings files for this workspace, the one that wins first: its own, then the user's. */
export const claudeSettingsFiles = Effect.gen(function* () {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const configDir = yield* claudeConfigDir;

  return [
    path.join(ws.root, ".claude", "settings.local.json"),
    path.join(ws.root, ".claude", "settings.json"),
    ...Option.toArray(Option.map(configDir, (dir) => path.join(dir, "settings.json"))),
  ];
});

/**
 * The model Claude Code runs when none is picked, as its own settings set it: the environment,
 * then this workspace's settings, then the user's.
 */
export const claudeDefaultModel = Effect.fn("agentConfig.claudeDefaultModel")(function* () {
  const fromEnv = yield* envVar("ANTHROPIC_MODEL");

  if (Option.isSome(fromEnv)) return claudeModelName(fromEnv.value);

  for (const file of yield* claudeSettingsFiles) {
    const model = Option.flatMap(yield* peek(file), decodeModelSetting).pipe(
      Option.flatMapNullishOr((settings) => settings.model),
    );

    if (Option.isSome(model)) return claudeModelName(model.value);
  }

  return Option.none<string>();
});

/** The model Codex's own `config.toml` sets, if any. */
export const codexConfiguredModel = Effect.fn("agentConfig.codexConfiguredModel")(function* () {
  const path = yield* Path.Path;
  const dir = yield* codexHome;

  if (Option.isNone(dir)) return undefined;

  const config = yield* peek(path.join(dir.value, "config.toml"));

  return Option.getOrUndefined(Option.flatMap(config, codexConfigModel));
});
