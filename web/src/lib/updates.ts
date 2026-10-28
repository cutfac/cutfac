import { Schema } from "effect";

/**
 * What the board shows about updates at the foot of its sidebar: nothing, a download the user asked
 * for, or a version ready to install with a restart.
 */
export const UpdateStatus = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("Downloading", { version: Schema.String, percent: Schema.Finite }),
  Schema.TaggedStruct("Ready", { version: Schema.String }),
]).pipe(Schema.toTaggedUnion("_tag"));

export type UpdateStatus = typeof UpdateStatus.Type;

/** A check from the menu found nothing newer, or failed. */
export const UpdateNotice = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("upToDate"), version: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("failed"), message: Schema.String }),
]);

export type UpdateNotice = typeof UpdateNotice.Type;

export const NO_UPDATE = UpdateStatus.cases.Idle.make({});

export const decodeUpdateStatus = Schema.decodeUnknownOption(UpdateStatus);

export const decodeUpdateNotice = Schema.decodeUnknownOption(UpdateNotice);
