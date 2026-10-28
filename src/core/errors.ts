import { Schema } from "effect";

/** A workspace file could not be read, written, or decoded, or a path left the workspace. */
export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()("WorkspaceError", {
  message: Schema.String,
}) {}

/** An item, learned entry, format, or feedback entry that does not exist. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  message: Schema.String,
}) {}

/** Input that is well-formed but not acceptable: an empty body, a missing file, a bad id. */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()("InvalidRequest", {
  message: Schema.String,
}) {}

/** The request clashes with work in progress, such as a second agent run on one item. */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
  message: Schema.String,
}) {}

/** An external command (ffmpeg, ffprobe, yt-dlp, an agent CLI) is missing or exited non-zero. */
export class CommandFailed extends Schema.TaggedError<CommandFailed>()("CommandFailed", {
  message: Schema.String,
}) {}

/** A site, such as a store listing or cutfac.com, could not be reached or understood. */
export class FetchFailed extends Schema.TaggedError<FetchFailed>()("FetchFailed", {
  message: Schema.String,
}) {}

export type CutfacError =
  | WorkspaceError
  | NotFound
  | InvalidRequest
  | Conflict
  | CommandFailed
  | FetchFailed;

/** What went wrong, as text to show or log. */
export const describeError = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
