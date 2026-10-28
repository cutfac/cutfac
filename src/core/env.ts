import { Config, Effect, Option } from "effect";

/** The environment variable `name`, or none when it is unset or empty. */
export const envVar = (name: string) =>
  Config.option(Config.String(name)).pipe(Effect.orElseSucceed(Option.none<string>));
