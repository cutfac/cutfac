import { Context, Effect, Layer, Option, Schema } from "effect";
import type { ChildProcessSpawner } from "effect/process";

import { BUNDLED } from "./core/build.ts";
import { run } from "./core/process.ts";

/**
 * A second copy of the free version's count of videos made, kept where losing or emptying the
 * count file doesn't reach it. A copy that can't be read now reads as none, and one that can't be
 * written is let go, as with the count file.
 */
export interface CountCopy {
  /** The count's lines kept so far, or none when the copy can't be read now. */
  readonly read: Effect.Effect<Option.Option<ReadonlyArray<string>>>;
  /** Keeps exactly `lines` from now on. */
  readonly write: (lines: ReadonlyArray<string>) => Effect.Effect<void>;
}

const NO_COPY: CountCopy = { read: Effect.succeedNone, write: () => Effect.void };

/** The count's copy in the account's login keychain: the desktop app's alone, none elsewhere. */
export const CountKeychain = Context.Reference<CountCopy>("cutfac/CountKeychain", {
  defaultValue: () => NO_COPY,
});

const SERVICE = "com.cutfac.app.free-videos";

const ACCOUNT = "videos";

/** What Keychain Access shows the item as. */
const LABEL = "Cutfac free version count";

/** `security find-generic-password`'s exit code when there is no such item. */
const NOT_FOUND = 44;

/** Long enough for `security` and `osascript`, short enough that a stuck one holds nothing up. */
const WAIT = "3 seconds";

/**
 * Whether the default keychain is unlocked. `security` asks for a locked keychain's password even
 * to report its state, so this asks the Security framework, which only reports it.
 */
const UNLOCKED =
  'ObjC.import("Security"); var k = Ref(), s = Ref(); ' +
  "$.SecKeychainCopyDefault(k) === 0 && $.SecKeychainGetStatus(k[0], s) === 0 && " +
  '(s[0] & 1) === 1 ? "unlocked" : "locked"';

const decodeLines = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)));

/**
 * The copy in the login keychain, only from the binary the desktop app bundles. It is written and
 * read only through `/usr/bin/security`, which the item then trusts, so reading it never asks the
 * user; and only while the keychain is unlocked, since a locked one would ask for its password.
 */
export const countKeychain = Layer.effect(
  CountKeychain,
  Effect.gen(function* () {
    if (!BUNDLED) return NO_COPY;
    const services = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner>();

    const exec = (command: string, args: ReadonlyArray<string>) =>
      run(command, args).pipe(Effect.timeout(WAIT), Effect.option, Effect.provideContext(services));

    const unlocked = Effect.map(
      exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", UNLOCKED]),
      Option.exists(({ code, stdout }) => code === 0 && stdout.trim() === "unlocked"),
    );

    const whileUnlocked = <A>(effect: Effect.Effect<Option.Option<A>>) =>
      Effect.flatMap(unlocked, (open) => (open ? effect : Effect.succeedNone));

    const read = whileUnlocked(
      Effect.map(
        exec("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]),
        Option.flatMap(({ code, stdout }) => {
          if (code === NOT_FOUND) return Option.some<ReadonlyArray<string>>([]);

          return code === 0 ? decodeLines(stdout.trim()) : Option.none();
        }),
      ),
    );

    const write = (lines: ReadonlyArray<string>) =>
      Effect.asVoid(
        whileUnlocked(
          exec("/usr/bin/security", [
            "add-generic-password",
            "-U",
            "-s",
            SERVICE,
            "-a",
            ACCOUNT,
            "-l",
            LABEL,
            "-w",
            JSON.stringify(lines),
          ]),
        ),
      );

    return { read, write } satisfies CountCopy;
  }),
);
