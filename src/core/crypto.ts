import { Crypto, Effect } from "effect";
import { Hex } from "effect/encoding";

export const newUuid = Effect.flatMap(Crypto.Crypto, (crypto) =>
  Effect.orDie(crypto.randomUUIDv4()),
);

/** Hex SHA-256, as `BundledSkill.shipped` lists them. */
export const sha256 = Effect.fn("crypto.sha256")(function* (text: string) {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* Effect.orDie(crypto.digest("SHA-256", new TextEncoder().encode(text)));

  return Hex.encode(digest);
});
