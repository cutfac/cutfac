import { expect } from "bun:test";
import path from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Option } from "effect";

import { whichIn } from "../src/core/process.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

it.live("finds the first program on PATH it can run, past files it can't and folders", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-which-" });
    const notRunnable = path.join(root, "a");
    const folder = path.join(root, "b");
    const runnable = path.join(root, "c");

    for (const dir of [notRunnable, folder, runnable]) yield* fs.makeDirectory(dir);

    yield* fs.writeFileString(path.join(notRunnable, "tool"), "#!/bin/sh\n");
    yield* fs.makeDirectory(path.join(folder, "tool"));
    yield* fs.writeFileString(path.join(runnable, "tool"), "#!/bin/sh\n");
    yield* fs.chmod(path.join(runnable, "tool"), 0o755);

    const searchPath = ["", notRunnable, folder, runnable].join(":");

    expect(yield* whichIn("tool", searchPath)).toEqual(Option.some(path.join(runnable, "tool")));
    expect(yield* whichIn("missing", searchPath)).toEqual(Option.none());
  }),
);
