import { Effect, Schema } from "effect";
import { Toolkit } from "effect/ai";

import { FormatDoc } from "../core/formatSchema.ts";
import { checkFormat } from "../core/formatSpec.ts";
import { formatNotices, getFormat, readFormats, saveFormat } from "../core/library.ts";
import { Workspace } from "../core/workspace.ts";
import { AbsDir, Created, describe, tool, toolRunner } from "./tool.ts";

const FormatDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  absDir: AbsDir,
  doc: FormatDoc,
  readme: Schema.optional(Schema.String),
});

const ById = Schema.Struct({ id: Schema.String });

const FormatProblem = Schema.Struct({
  kind: Schema.Literals(["spec", "skill", "program", "file"]).annotate(
    describe(
      "spec: format.yaml itself; skill, program, file: something it names that is not there",
    ),
  ),
  subject: Schema.String,
  message: Schema.String,
});

const ListFormats = tool("list_formats", {
  description: "Reusable format recipes.",
  success: Schema.Struct({
    formats: Schema.Array(Schema.Struct({ id: Schema.String, ...FormatDoc.fields })),
    notices: Schema.Array(Schema.String).annotate(
      describe("formats left out because their format.yaml doesn't read, and how to fix each"),
    ),
  }),
  readonly: true,
});

const GetFormat = tool("get_format", {
  description:
    "One format with its README and absolute folder. Its skills, inputs, and the files its choices point at " +
    "are relative to that folder; read them before making an item in it.",
  parameters: ById,
  success: FormatDetail,
  readonly: true,
});

const SaveFormat = tool("save_format", {
  description:
    "Create or replace a format's format.yaml, written from scratch or brought in from a link. " +
    "Write its README, previews, and choice files into the returned folder, then call check_format.",
  parameters: Schema.Struct({ id: Schema.optional(Schema.String), ...FormatDoc.fields }),
  success: Created,
  overwrites: true,
});

const CheckFormat = tool("check_format", {
  description:
    "Whether a format is ready to use: mistakes in its format.yaml, and the skills, programs, and files it names " +
    "that are missing. Fix every problem it lists; install skills or programs only with the user's consent. " +
    "Also says where each installed skill and program is, and each program's version.",
  parameters: ById,
  success: Schema.Struct({
    ready: Schema.Boolean,
    problems: Schema.Array(FormatProblem),
    skills: Schema.Record(Schema.String, Schema.String).annotate(
      describe("absolute SKILL.md of each skill the format names that is installed"),
    ),
    programs: Schema.Record(
      Schema.String,
      Schema.Struct({
        path: Schema.String,
        version: Schema.optional(Schema.String.annotate(describe("what `--version` printed"))),
      }),
    ).annotate(describe("each program the format requires that is installed, and where")),
  }),
  readonly: true,
});

export const FormatsToolkit = Toolkit.make(ListFormats, GetFormat, SaveFormat, CheckFormat);

export const formatsHandlers = FormatsToolkit.toLayer(
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const run = yield* toolRunner;

    return FormatsToolkit.of({
      list_formats: () =>
        run(
          Effect.map(readFormats(), ({ formats, unreadable }) => ({
            formats: formats.map((format) => ({ id: format.id, ...format.doc })),
            notices: formatNotices(unreadable),
          })),
        ),

      get_format: ({ id }) =>
        run(
          Effect.gen(function* () {
            const format = yield* getFormat(id);

            return { ...format, absDir: yield* ws.abs(format.dir) };
          }),
        ),

      save_format: (input) =>
        run(
          Effect.gen(function* () {
            const format = yield* saveFormat(input);

            return { id: format.id, absDir: yield* ws.abs(format.dir) };
          }),
        ),

      check_format: ({ id }) =>
        run(
          Effect.gen(function* () {
            const check = yield* checkFormat(id);

            const skills = yield* Effect.forEach(Object.entries(check.skills), ([name, file]) =>
              Effect.map(ws.abs(file), (abs): readonly [string, string] => [name, abs]),
            );

            return { ...check, skills: Object.fromEntries(skills) };
          }),
        ),
    });
  }),
);
