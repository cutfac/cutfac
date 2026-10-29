import { createHash } from "node:crypto";

import { Context, Effect, Layer, Option, Schema } from "effect";
import { ChildProcessSpawner } from "effect/process";

import { runChecked } from "../src/core/process.ts";

/**
 * This Mac as a perpetual license's activation knows it: the name the buyer sees among their
 * activations, and a hash of its hardware UUID, which cutfac.com ties the activation to so a copied
 * one fails on another Mac.
 */
export interface Mac {
  readonly label: string;
  readonly machine: string;
}

/** The hardware UUID couldn't be read, so this Mac can't be activated. */
export class MacUnknown extends Schema.TaggedError<MacUnknown>()("MacUnknown", {
  message: Schema.String,
}) {}

const PLATFORM_UUID = /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/u;

/** The hardware UUID in `ioreg -rd1 -c IOPlatformExpertDevice`'s output. */
export const platformUuidIn = (ioreg: string) =>
  Option.map(Option.fromNullishOr(PLATFORM_UUID.exec(ioreg)?.[1]), (uuid) => uuid.toUpperCase());

/** What cutfac.com sees of the UUID: a hash, so the Mac's own ID never leaves it. */
export const machineOf = (uuid: string) =>
  createHash("sha256").update(`cutfac-activation:${uuid}`).digest("hex");

const readMac = Effect.gen(function* () {
  const ioreg = yield* runChecked("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]).pipe(
    Effect.mapError((error) => new MacUnknown({ message: error.message })),
  );

  const uuid = yield* Effect.fromOption(platformUuidIn(ioreg)).pipe(
    Effect.mapError(() => new MacUnknown({ message: "ioreg showed no IOPlatformUUID" })),
  );

  const name = yield* runChecked("/usr/sbin/scutil", ["--get", "ComputerName"]).pipe(
    Effect.map((text) => text.trim()),
    Effect.orElseSucceed(() => ""),
  );

  return { label: name === "" ? "Mac" : name, machine: machineOf(uuid) } satisfies Mac;
});

/** Reads this Mac for its license activation. */
export class ThisMac extends Context.Service<
  ThisMac,
  { readonly mac: Effect.Effect<Mac, MacUnknown> }
>()("cutfac/desktop/ThisMac") {
  static readonly layer = Layer.effect(
    ThisMac,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      return ThisMac.of({
        mac: readMac.pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
      });
    }),
  );
}
