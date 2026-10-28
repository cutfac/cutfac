import { Schema } from "effect";

/** The desktop app's free version has made all of its videos. The server's message is for agents. */
export class FreeLimitReached extends Schema.TaggedError<FreeLimitReached>()("FreeLimitReached", {
  message: Schema.String,
}) {}
