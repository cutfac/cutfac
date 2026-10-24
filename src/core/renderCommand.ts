import { Effect, Option } from "effect";

import type { Access } from "./agentPermissions.ts";
import { InvalidRequest } from "./errors.ts";
import { getItem } from "./items.ts";
import { getFormat } from "./library.ts";

/** `arg` quoted for the shell, so it reaches the command as one argument, exactly as given. */
export const shellQuote = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;

export interface RenderCall {
  readonly item: string;
  /** Any shell command, for the user's own sessions and runs with full access. */
  readonly command?: string | undefined;
  /** Arguments for the `render` command of the item's format. */
  readonly args?: ReadonlyArray<string> | undefined;
}

const LIMITED =
  "This run may render only with the render command of the item's format: pass its arguments as args. " +
  "Run any other command through your own shell, where the user's permissions apply, or tell the " +
  "user it needs Full access under Permissions in Setup.";

/**
 * The command a render call runs: the `render` command of the item's format with `args`, or
 * `command` as given; none when the call only waits. A render runs outside the agent's own
 * permissions, so a board run with less than full `access` may run only the one its format
 * declares. The user's own sessions have none and approve each call themselves.
 */
export const renderCommand = Effect.fn("render.command")(function* (
  { item, command, args }: RenderCall,
  access: Option.Option<Access>,
) {
  const limited = Option.exists(access, (given) => given !== "full");

  if (command !== undefined && args !== undefined) {
    return yield* new InvalidRequest({ message: "Pass command or args, not both" });
  }

  if (command !== undefined) {
    if (limited) return yield* new InvalidRequest({ message: LIMITED });

    return command;
  }

  if (args === undefined) return undefined;

  const { doc } = yield* getItem(item);

  // An item may name a format that has no folder.
  const format =
    doc.format === undefined
      ? undefined
      : yield* getFormat(doc.format).pipe(Effect.catchTag("NotFound", () => Effect.void));

  const render = format?.doc.render;

  if (render === undefined) {
    const instead = limited
      ? "render it through your own shell, where the user's permissions apply"
      : "pass the command instead";

    return yield* new InvalidRequest({
      message: `The format of ${item} has no render command; ${instead}`,
    });
  }

  return [render, ...args.map(shellQuote)].join(" ");
});
