import { Effect, FileSystem, Schema } from "effect";

const decodePackage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString })),
);

export const packageVersion = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file)).pipe(
    Effect.flatMap(decodePackage),
    Effect.map(({ version }) => version),
  );
