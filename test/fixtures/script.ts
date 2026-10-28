import { Effect, FileSystem, Schema } from "effect";

import { runScript } from "../../electron/script.ts";

class Broken extends Schema.TaggedError<Broken>()("Broken", { message: Schema.String }) {}

const [mode, started = "", cleaned = ""] = Bun.argv.slice(2);

runScript(
  "fixture",
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (mode === "code") return 3;

    if (mode === "fail") return yield* new Broken({ message: "it broke" });

    return yield* fs.writeFileString(started, "").pipe(
      Effect.andThen(Effect.sleep("1 minute")),
      Effect.as(0),
      Effect.onError(() => Effect.ignore(fs.writeFileString(cleaned, ""))),
    );
  }),
);
