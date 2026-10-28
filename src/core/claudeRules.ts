import { Effect, Option, Schema } from "effect";

import { FORMAT_FILE, type Format } from "./library.ts";
import { Workspace } from "./workspace.ts";
import { CONFIG_FILE } from "./workspaceRoot.ts";
import { SETTINGS_FILES } from "./workspaceTrust.ts";

/**
 * What Cutfac let a Claude Code run from the board use unasked, before Claude asked the board: the
 * rules format.yaml files listed when Cutfac wrote them, which no one chose.
 */
const EARLIER_RUN_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash(ffmpeg:*)",
  "Bash(ffprobe:*)",
];

/** What cutfac.yaml listed when Cutfac wrote it, which no one chose and so has nothing to move. */
const EARLIER_DEFAULTS = new Set([
  ...EARLIER_RUN_TOOLS,
  "Bash(bun:*)",
  "Bash(npx:*)",
  "Bash(ls:*)",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
]);

const RUN_TOOLS = new Set(EARLIER_RUN_TOOLS);

const Rules = Schema.Array(Schema.String);

/** Where cutfac.yaml and format.yaml listed Claude Code rules, before they moved out. */
const ConfigRules = Schema.Struct({
  agent: Schema.optional(Schema.Struct({ claudeAllowedTools: Schema.optional(Rules) })),
});

const FormatRules = Schema.Struct({ tools: Schema.optional(Rules) });

/**
 * What the agent should know about Claude Code rules still listed in cutfac.yaml or a
 * format.yaml, which Cutfac read before they moved to the workspace's `.claude/settings.json`.
 */
export const movedRuleNotices = Effect.fn("claudeRules.movedNotices")(function* (
  formats: ReadonlyArray<Format>,
) {
  const ws = yield* Workspace;
  const settings = yield* ws.abs(SETTINGS_FILES[0]);

  const rulesIn = <A>(
    file: string,
    schema: Schema.Codec<A>,
    pick: (doc: A) => ReadonlyArray<string> | undefined,
  ) =>
    ws.readYaml(file, schema).pipe(
      Effect.option,
      Effect.map((doc) => Option.getOrUndefined(Option.flatMapNullishOr(doc, pick)) ?? []),
    );

  const notice = (file: string, key: string, rules: ReadonlyArray<string>) =>
    `${file} lists ${key} (${rules.join(", ")}), which Cutfac no longer reads. Add the rules runs ` +
    `still need to permissions.allow in ${settings}, as for any Claude Code session there, then ` +
    `remove ${key} from ${file}.`;

  const config = yield* rulesIn(CONFIG_FILE, ConfigRules, (doc) => doc.agent?.claudeAllowedTools);
  const configMoved = config.filter((rule) => !EARLIER_DEFAULTS.has(rule));

  const fromFormats = yield* Effect.forEach(
    formats,
    Effect.fnUntraced(function* (format) {
      const file = `${format.dir}/${FORMAT_FILE}`;
      const rules = yield* rulesIn(file, FormatRules, (doc) => doc.tools);
      const moved = rules.filter((rule) => !RUN_TOOLS.has(rule));

      return moved.length === 0 ? [] : [notice(file, "tools", moved)];
    }),
    { concurrency: 8 },
  );

  return [
    ...(configMoved.length === 0
      ? []
      : [notice(CONFIG_FILE, "agent.claudeAllowedTools", configMoved)]),
    ...fromFormats.flat(),
  ];
});
