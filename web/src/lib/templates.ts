import type { FormatStatus, InputField } from "../api.ts";

/** Choice previews may be clips as well as stills. */
export const isClip = (path: string) => /\.(mp4|m4v|mov|webm)$/i.test(path);

/** Broken: its format.yaml does not read. Incomplete: it reads, but something it needs is missing. */
export type TemplateState = "ready" | "incomplete" | "broken";

export function templateState(status: FormatStatus): TemplateState {
  if (status.format === undefined) return "broken";

  return status.check.ready ? "ready" : "incomplete";
}

const RANK = { ready: 0, incomplete: 1, broken: 2 } satisfies Record<TemplateState, number>;

const titleOf = (status: FormatStatus) => status.format?.doc.title ?? status.id;

/** Format-relative files the template names but does not have, which the UI leaves out. */
export function missingFiles(status: FormatStatus): ReadonlySet<string> {
  return new Set(status.check.problems.filter((p) => p.kind === "file").map((p) => p.subject));
}

/** The workspace-relative still that stands for a template: its first choice preview that exists. */
export function coverOf(status: FormatStatus): string | undefined {
  const { format } = status;

  if (format === undefined) return undefined;

  const missing = missingFiles(status);

  const preview = format.doc.inputs
    .flatMap((input) => input.choices)
    .map((choice) => choice.preview)
    .find((path) => path !== undefined && !isClip(path) && !missing.has(path));

  return preview === undefined ? undefined : `${format.dir}/${preview}`;
}

/** Ready templates first, then the ones to fix, each by title. */
export function sortTemplates(statuses: ReadonlyArray<FormatStatus>): FormatStatus[] {
  return statuses.toSorted(
    (a, b) =>
      RANK[templateState(a)] - RANK[templateState(b)] || titleOf(a).localeCompare(titleOf(b)),
  );
}

/** What the user's agent needs to turn a link into a template here. Agent prompts stay in English. */
export function importPrompt(link: string, root: string): string {
  return [
    `Read ${link.trim()} and turn it into a Content Factory template (a format) in the workspace at ${root}.`,
    'Follow "Import a template from a link" in the content-factory skill:',
    "- ask me before installing any skill, package, or program, and say what each one is for;",
    "- write formats/<id>/format.yaml with its README, previews, and choice files, and record where it came from and its license;",
    "- call check_format and fix what it lists until the template is ready.",
  ].join("\n");
}

/** What the user's agent needs to finish a template that is not ready. */
export function fixPrompt(id: string, root: string): string {
  return (
    `Call check_format on the "${id}" template in the Content Factory workspace at ${root} and fix what it lists, ` +
    'following "Import a template from a link" in the content-factory skill. Ask me before installing anything.'
  );
}

/** The inputs to send for a new item: blanks are left out, so the server fills in defaults. */
export function filledInputs(
  fields: ReadonlyArray<InputField>,
  values: Partial<Record<string, string>>,
) {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = values[field.id]?.trim();

      return value === undefined || value === "" ? [] : [[field.id, value] as const];
    }),
  );
}

/** Required inputs with neither a value nor a default, which keep an item from being made. */
export function missingInputs(
  fields: ReadonlyArray<InputField>,
  values: Partial<Record<string, string>>,
): InputField[] {
  const filled = filledInputs(fields, values);

  return fields.filter(
    (field) => field.required && field.default === undefined && filled[field.id] === undefined,
  );
}
