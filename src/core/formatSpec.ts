import { Duration, Effect, Option } from "effect";

import { InvalidRequest } from "./errors.ts";
import type { FormatDoc, InputField } from "./formatSchema.ts";
import { FORMAT_FILE, type Format, getFormat, isSimpleId } from "./library.ts";
import { run, which } from "./process.ts";
import { SKILL_FOLDERS } from "./skill.ts";
import { Workspace, foldersWith } from "./workspace.ts";

/** Skill names as the Agent Skills spec has them: lowercase words joined by hyphens. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const INPUT_ID = /^[A-Za-z0-9_-]+$/;

/** A program name for PATH, not a path or a command line. */
const PROGRAM = /^[A-Za-z0-9._+-]+$/;

/**
 * What stands between a format and its first item: `spec` is a mistake in format.yaml, the rest
 * are a skill, program, or format-relative file that is not there.
 */
export interface FormatProblem {
  readonly kind: "spec" | "skill" | "program" | "file";
  /** The field, skill, program, or file the problem is about. */
  readonly subject: string;
  readonly message: string;
}

export interface FormatCheck {
  readonly ready: boolean;
  readonly problems: ReadonlyArray<FormatProblem>;
  /** Workspace-relative SKILL.md of each skill the format names that is installed. */
  readonly skills: Readonly<Record<string, string>>;
  /** Each program the format requires that is installed. */
  readonly programs: Readonly<Record<string, Program>>;
}

/** A program on PATH: where it is, and the release it reports when asked. */
export interface Program {
  readonly path: string;
  readonly version?: string;
}

/** A format folder as the board lists it: readable or not, and what it still needs. */
export interface FormatStatus {
  readonly id: string;
  readonly format?: Format | undefined;
  readonly check: FormatCheck;
}

const spec = (subject: string, message: string): FormatProblem => ({
  kind: "spec",
  subject,
  message,
});

/** A path inside the format folder: relative, `/`-separated, and never climbing out of it. */
export const isFormatPath = (path: string) =>
  path !== "" &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !/^[A-Za-z]:/.test(path) &&
  path.split("/").every((part) => part !== ".." && part !== "");

/** The format-relative files a format points at, preview images and clips first. */
export function formatFiles(doc: FormatDoc): string[] {
  const files = doc.inputs.flatMap((input) =>
    input.choices.flatMap((choice) => [
      ...(choice.preview === undefined ? [] : [choice.preview]),
      ...choice.files,
    ]),
  );

  return [...new Set(files)];
}

function duplicates(ids: ReadonlyArray<string>): string[] {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

function inputProblems(input: InputField): FormatProblem[] {
  const subject = `inputs.${input.id}`;
  const problems: FormatProblem[] = [];
  const ids = input.choices.map((choice) => choice.id);

  if (!INPUT_ID.test(input.id)) {
    problems.push(spec(subject, `Input id "${input.id}" may use only letters, digits, - and _`));
  }

  for (const id of duplicates(ids)) problems.push(spec(subject, `Choice "${id}" appears twice`));

  if (input.default !== undefined && ids.length > 0 && !ids.includes(input.default)) {
    problems.push(spec(subject, `Default "${input.default}" is not one of the choices`));
  }

  return problems;
}

/** Mistakes in a format.yaml that decoded: ids, names, and paths that cannot work. */
export function specProblems(doc: FormatDoc): FormatProblem[] {
  const problems: FormatProblem[] = [];

  if (doc.duration !== undefined && doc.duration.min > doc.duration.max) {
    problems.push(spec("duration", "duration.min is longer than duration.max"));
  }

  for (const skill of doc.skills) {
    if (!SKILL_NAME.test(skill.name)) {
      problems.push(
        spec("skills", `Skill name "${skill.name}" must be lowercase words joined by hyphens`),
      );
    }
  }

  for (const program of doc.requires) {
    if (!PROGRAM.test(program)) {
      problems.push(spec("requires", `"${program}" is not a program name; list just the name`));
    }
  }

  for (const id of duplicates(doc.inputs.map((input) => input.id))) {
    problems.push(spec("inputs", `Input "${id}" appears twice`));
  }

  problems.push(...doc.inputs.flatMap(inputProblems));

  for (const path of formatFiles(doc)) {
    if (!isFormatPath(path)) {
      problems.push(spec("inputs", `"${path}" must be a path inside the format folder`));
    }
  }

  return problems;
}

/** The first workspace skill folder that holds `name`'s SKILL.md. */
const findSkill = Effect.fnUntraced(function* (name: string) {
  const ws = yield* Workspace;

  for (const folder of SKILL_FOLDERS) {
    const file = `${folder}/${name}/SKILL.md`;

    if (yield* ws.exists(file)) return file;
  }

  return undefined;
});

/** Check a format against its own spec and against this workspace and machine. */
export const checkFormatDoc = Effect.fn("formatSpec.checkFormatDoc")(function* (format: Format) {
  const ws = yield* Workspace;
  const { doc } = format;
  const problems = specProblems(doc);
  const skills: Record<string, string> = {};

  for (const skill of doc.skills.filter((s) => SKILL_NAME.test(s.name))) {
    const file = yield* findSkill(skill.name);

    if (file !== undefined) {
      skills[skill.name] = file;
      continue;
    }

    const from = skill.source === undefined ? "" : ` from ${skill.source}`;

    problems.push({
      kind: "skill",
      subject: skill.name,
      message: `Skill "${skill.name}" is not installed in ${SKILL_FOLDERS.join(" or ")}; install it${from}`,
    });
  }

  const programs: Record<string, Program> = {};

  for (const program of doc.requires.filter((p) => PROGRAM.test(p))) {
    const path = yield* which(program);

    if (Option.isSome(path)) {
      programs[program] = { path: path.value };
    } else {
      problems.push({
        kind: "program",
        subject: program,
        message: `${program} is not installed or not on PATH`,
      });
    }
  }

  for (const path of formatFiles(doc).filter(isFormatPath)) {
    if (!(yield* ws.exists(`${format.dir}/${path}`))) {
      problems.push({
        kind: "file",
        subject: path,
        message: `${format.dir}/${path} does not exist`,
      });
    }
  }

  const check: FormatCheck = { ready: problems.length === 0, problems, skills, programs };

  return check;
});

const unreadable = (message: string): FormatCheck => ({
  ready: false,
  problems: [spec(FORMAT_FILE, message)],
  skills: {},
  programs: {},
});

/** One format's status; a format.yaml that does not decode is reported, not raised. */
export const formatStatus = (id: string) =>
  getFormat(id).pipe(
    Effect.flatMap((format) =>
      Effect.map(checkFormatDoc(format), (check): FormatStatus => ({ id, format, check })),
    ),
    Effect.catchTag("WorkspaceError", (error) =>
      Effect.succeed<FormatStatus>({ id, check: unreadable(error.message) }),
    ),
    Effect.withSpan("formatSpec.formatStatus"),
  );

/** Every folder under formats/ with a format.yaml, broken ones included. */
export const formatStatuses = Effect.fn("formatSpec.formatStatuses")(function* () {
  const ws = yield* Workspace;
  const ids = (yield* foldersWith(ws.config.paths.formats, FORMAT_FILE)).filter(isSimpleId);

  return yield* Effect.forEach(ids, formatStatus, { concurrency: 8 });
});

/** The format an item names, when its folder is there and its format.yaml reads. */
export const itemFormat = (formatId: string | undefined) =>
  formatId === undefined ? Effect.succeedNone : Effect.option(getFormat(formatId));

/** The first line `--version` prints, or none when the program doesn't answer it in time. */
const versionOf = (path: string) =>
  run(path, ["--version"]).pipe(
    Effect.timeout(Duration.seconds(3)),
    Effect.map((result) => {
      if (result.code !== 0) return undefined;

      const output = result.stdout.trim() === "" ? result.stderr : result.stdout;
      const line = output.trim().split("\n")[0]?.trim() ?? "";

      return line === "" ? undefined : line;
    }),
    Effect.orElseSucceed(() => undefined),
  );

/**
 * Check a format by id, failing only when there is no such format. Says where each program it
 * requires is and which release, so an agent need not look for them; the board's list leaves the
 * releases out, as asking each program takes a moment.
 */
export const checkFormat = Effect.fn("formatSpec.checkFormat")(function* (id: string) {
  const { check } = yield* formatStatus(id);

  const programs = yield* Effect.forEach(
    Object.entries(check.programs),
    ([name, program]) =>
      Effect.map(versionOf(program.path), (version): [string, Program] => [
        name,
        version === undefined ? program : { ...program, version },
      ]),
    { concurrency: "unbounded" },
  );

  return { ...check, programs: Object.fromEntries(programs) };
});

/**
 * An item's inputs: the given values checked against the format's fields, with defaults filled
 * in, in the order the format lists them. Blank values count as not given.
 */
export const resolveInputs = Effect.fn("formatSpec.resolveInputs")(function* (
  formatId: string,
  fields: ReadonlyArray<InputField>,
  given: Readonly<Record<string, string>>,
) {
  const known = new Set(fields.map((field) => field.id));
  const unknown = Object.keys(given).filter((id) => !known.has(id));

  if (unknown.length > 0) {
    const names = fields.map((field) => field.id).join(", ") || "none";

    return yield* new InvalidRequest({
      message: `Format ${formatId} has no input ${unknown.join(", ")} (its inputs: ${names})`,
    });
  }

  const inputs: Record<string, string> = {};

  for (const field of fields) {
    const value = given[field.id]?.trim() || field.default;
    const choices = field.choices.map((choice) => choice.id);

    if (value === undefined) {
      if (!field.required) continue;

      return yield* new InvalidRequest({
        message: `Format ${formatId} needs ${field.title} (${field.id})`,
      });
    }

    if (choices.length > 0 && !choices.includes(value)) {
      return yield* new InvalidRequest({
        message: `${field.title} (${field.id}) must be one of ${choices.join(", ")}`,
      });
    }

    inputs[field.id] = value;
  }

  return inputs;
});

/** The input fields of a format, or none when the item names a format that is not there. */
export const inputFieldsOf = (formatId: string) =>
  getFormat(formatId).pipe(
    Effect.map((format) => format.doc.inputs),
    Effect.catchTag("NotFound", () => Effect.succeed<ReadonlyArray<InputField>>([])),
  );
