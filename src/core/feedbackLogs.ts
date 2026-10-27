import { Effect, FileSystem, Option, Schema } from "effect";

import { LogDir, dayLogs } from "./logFile.ts";

/** How much of the log goes with feedback: the newest lines, enough to cover the last few days. */
export const MAX_FEEDBACK_LOG_CHARS = 1024 * 1024;

const decodeLevel = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ level: Schema.String })),
);

/** How many of the log's lines are errors, for the board to say what the log could explain. */
export const errorCount = (logs: string) =>
  logs
    .split("\n")
    .filter((line) =>
      Option.exists(decodeLevel(line), ({ level }) => level === "ERROR" || level === "FATAL"),
    ).length;

/** `text` without its first `cut` characters, from the next whole line on. */
const fromLine = (text: string, cut: number) => {
  if (cut <= 0) return text;

  const rest = text.slice(cut);
  const next = rest.indexOf("\n");

  return next === -1 ? "" : rest.slice(next + 1);
};

/**
 * The newest of the desktop app's logs as feedback carries them: each file under its name, oldest
 * first, the oldest cut from its start to fit `MAX_FEEDBACK_LOG_CHARS`. None for the open-source
 * CLI, or when there are none or they can't be read.
 */
export const recentLogs = Effect.gen(function* () {
  const dir = yield* LogDir;

  if (Option.isNone(dir)) return Option.none<string>();

  const fs = yield* FileSystem.FileSystem;

  // Newest first until there is enough; the rest is never read.
  const kept: string[] = [];

  for (const { name, file } of yield* dayLogs(dir.value)) {
    const room = MAX_FEEDBACK_LOG_CHARS - kept.join("\n").length;

    if (room <= 0) break;

    const text = (yield* fs.readFileString(file)).trimEnd();
    const section = `# ${name}\n${fromLine(text, text.length - room)}\n`;

    kept.push(section);
  }

  const logs = kept.toReversed().join("\n");

  return logs.trim() === "" ? Option.none<string>() : Option.some(logs);
}).pipe(Effect.orElseSucceed(() => Option.none<string>()));
