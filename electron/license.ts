import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Semaphore,
} from "effect";
import { HttpClient } from "effect/http";

import {
  LicenseKey,
  LicenseRecord,
  isPaid,
  type SavedLicense,
  type SecretLicenseKey,
  updatesUntil,
} from "../src/license.ts";
import type { LicenseCheck } from "../web/src/desktop.ts";
import {
  type CheckingMac,
  activateMac,
  deactivateMac,
  fetchLicense,
  renewalCheckout,
} from "./licenseRequests.ts";
import { ThisMac } from "./thisMac.ts";

/** While the app runs, it asks again this often. */
const CHECK_EVERY = "1 day";

/** Coming back to the app asks again at most this often. */
const ASK_AGAIN_AFTER = Duration.minutes(1);

/**
 * A key as the board takes it. Keys travel in an HTTP header, which takes visible ASCII only, and
 * Polar's are far shorter than the limit; anything longer is a paste gone wrong.
 */
const decodeKey = Schema.decodeUnknownOption(
  Schema.RedactedFromValue(
    LicenseKey.check(Schema.isMaxLength(128), Schema.isPattern(/^[\x21-\x7e]+$/)),
  ),
);

/** The key as typed or pasted, without surrounding space, if it can be one. */
export const licenseKeyFrom = (input: string) => decodeKey(input.trim());

/** The key and cutfac.com's answer about it couldn't be saved. */
export class LicenseNotSaved extends Schema.TaggedError<LicenseNotSaved>()("LicenseNotSaved", {
  cause: Schema.Defect(),
}) {}

/** The license as the desktop app keeps it: the key, cutfac.com's last answer, and this Mac's activation. */
export interface DesktopLicense extends SavedLicense {
  readonly activation: Option.Option<string>;
}

/** What the board hears when it gives a key: no answer, or cutfac.com's. */
const checkOf = (answer: Option.Option<LicenseRecord>): LicenseCheck =>
  Option.match(answer, {
    onNone: (): LicenseCheck => "unavailable",
    onSome: LicenseRecord.match({
      LicenseGrant: (): LicenseCheck => "granted",
      // Activating right away answers this, so it stands only when that couldn't be done.
      LicenseRefusal: ({ refusal }): LicenseCheck =>
        refusal === "unactivated" ? "unavailable" : refusal,
    }),
  });

const isUnactivated = LicenseRecord.match({
  LicenseGrant: () => false,
  LicenseRefusal: ({ refusal }) => refusal === "unactivated",
});

/** Freeing this Mac: done, or cutfac.com couldn't be reached, so nothing changed. */
export type Deactivation = "deactivated" | "unavailable";

/** Where the app keeps the license key, cutfac.com's last answer about it, and the activation. */
export class LicenseSettings extends Context.Service<
  LicenseSettings,
  {
    readonly load: Effect.Effect<DesktopLicense>;
    /** Saves all three together; none drops the old one. */
    save(
      key: SecretLicenseKey,
      record: Option.Option<LicenseRecord>,
      activation: Option.Option<string>,
    ): Effect.Effect<void, LicenseNotSaved>;
    /** Forgets the key, its answer and its activation. */
    readonly clear: Effect.Effect<void, LicenseNotSaved>;
  }
>()("cutfac/desktop/LicenseSettings") {}

/**
 * The desktop app's license. Without the paid plan the app is the free version; it never locks.
 */
export class License extends Context.Service<
  License,
  {
    /** Checks a key from the board and keeps it unless it names no license. */
    setKey(input: string): Effect.Effect<LicenseCheck, LicenseNotSaved>;
    /** Catches up when the user comes back, asking again about a saved key that isn't paid now. */
    readonly refresh: Effect.Effect<void>;
    readonly hasKey: Effect.Effect<boolean>;
    /** Frees this Mac's activation and forgets the key, so it can be used on another Mac. */
    readonly deactivate: Effect.Effect<Deactivation, LicenseNotSaved>;
    /** When a perpetual license's updates end; none for a plan, the free version or no answer. */
    readonly updatesEnd: Effect.Effect<Option.Option<number>>;
    /**
     * Whether a build released at `releasedAt` keeps the paid plan: always, but past a perpetual
     * license's updates. Before saying no it asks cutfac.com again, which counts a renewal.
     */
    covers(releasedAt: number): Effect.Effect<boolean>;
    /** A checkout that renews the saved key's updates, in `locale`, if cutfac.com gives one. */
    renewal(locale: string): Effect.Effect<Option.Option<string>>;
  }
>()("cutfac/desktop/License") {
  /**
   * Keeps cutfac.com's answer about the saved key fresh: asks at launch and once a day, and again
   * when the user comes back to a key that doesn't unlock the paid plan, perhaps after renewing,
   * freeing another Mac or getting online. `changed` tells the board the paid plan unlocked or ran
   * out, once the settings that say so are saved.
   */
  static readonly layer = (changed: Effect.Effect<void>) => Layer.effect(License, make(changed));

  static readonly unavailable = Layer.succeed(
    License,
    License.of({
      setKey: () => Effect.succeed("unavailable"),
      refresh: Effect.void,
      hasKey: Effect.succeed(false),
      deactivate: Effect.succeed("unavailable"),
      updatesEnd: Effect.succeedNone,
      covers: () => Effect.succeed(true),
      renewal: () => Effect.succeedNone,
    }),
  );
}

/** cutfac.com's answer about a key, if it gave one, and the activation the key holds on this Mac. */
interface Confirmed {
  readonly answer: Option.Option<LicenseRecord>;
  readonly activation: Option.Option<string>;
}

const make = Effect.fnUntraced(function* (changed: Effect.Effect<void>) {
  const settings = yield* LicenseSettings;
  const client = yield* HttpClient.HttpClient;
  const thisMac = yield* ThisMac;
  const initial = yield* settings.load;
  const saved = yield* Ref.make(initial);
  const paid = yield* Ref.make(yield* isPaid(initial));
  const askedAt = yield* Ref.make(Option.none<number>());

  // Each check runs after the one before, so an answer about an old key never lands on a new one.
  const serialized = (yield* Semaphore.make(1)).withPermits(1);

  const online = <A, E>(request: Effect.Effect<A, E, HttpClient.HttpClient>) =>
    request.pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.option);

  /**
   * Asks about `key` with this Mac's `activation`. A perpetual license cutfac.com says isn't
   * activated here is activated, then asked about again: an app from before activations saved the
   * key, or the activation was freed. A key with no room left on another Mac is refused as `full`.
   */
  const confirm = Effect.fnUntraced(function* (
    key: SecretLicenseKey,
    activation: Option.Option<string>,
  ) {
    const mac = yield* Effect.option(thisMac.mac);

    // The Mac goes with every check, so cutfac.com holds a perpetual license to its activations.
    const sent = (held: Option.Option<string>) =>
      Option.map(mac, ({ machine }): CheckingMac => ({ machine, activation: held }));

    const first = yield* online(fetchLicense(key, sent(activation)));

    if (!Option.exists(first, isUnactivated))
      return { answer: first, activation } satisfies Confirmed;

    // A Mac whose hardware ID can't be read can't be activated, which is no answer rather than a refusal.
    if (Option.isNone(mac)) return { answer: Option.none(), activation } satisfies Confirmed;

    const activated = yield* online(activateMac(key, mac.value));

    if (Option.isNone(activated)) return { answer: Option.none(), activation } satisfies Confirmed;

    if ("refusal" in activated.value) {
      const checkedAt = yield* Clock.currentTimeMillis;
      const refusal = activated.value.refusal;

      return {
        answer: Option.some(LicenseRecord.cases.LicenseRefusal.make({ checkedAt, refusal })),
        activation: Option.none(),
      } satisfies Confirmed;
    }

    const held = activated.value.activation;

    return {
      answer: yield* online(fetchLicense(key, sent(held))),
      activation: held,
    } satisfies Confirmed;
  });

  /** Tells the board when the plan changed, which a grant running out does on its own. */
  const publish = Effect.gen(function* () {
    const next = yield* Effect.flatMap(Ref.get(saved), isPaid);

    if (yield* Ref.modify(paid, (was) => [was !== next, next])) yield* changed;
  });

  const keep = Effect.fnUntraced(function* (
    key: SecretLicenseKey,
    record: Option.Option<LicenseRecord>,
    activation: Option.Option<string>,
  ) {
    yield* Ref.set(saved, { key: Option.some(key), record, activation });

    // The board's server reads the plan from the saved settings, so they go first.
    yield* settings.save(key, record, activation);
    yield* publish;
  });

  /** Asks about the saved key. No answer keeps the last one, which holds until its grace runs out. */
  const check = Effect.gen(function* () {
    yield* Ref.set(askedAt, Option.some(yield* Clock.currentTimeMillis));

    yield* serialized(
      Effect.gen(function* () {
        const { key, activation } = yield* Ref.get(saved);

        if (Option.isNone(key)) return;

        const confirmed = yield* confirm(key.value, activation);

        yield* Option.match(confirmed.answer, {
          onNone: () => publish,
          onSome: (record) => keep(key.value, Option.some(record), confirmed.activation),
        });
      }),
    );
  }).pipe(
    Effect.catchTag("LicenseNotSaved", (error) =>
      Effect.logWarning("The license answer wasn't saved", error.cause),
    ),
  );

  yield* check.pipe(
    Effect.repeat(Schedule.fixed(CHECK_EVERY)),
    Effect.forkScoped({ startImmediately: true }),
  );

  const setKey = Effect.fn("License.setKey")(function* (
    input: string,
  ): Effect.fn.Return<LicenseCheck, LicenseNotSaved> {
    const key = licenseKeyFrom(input);

    if (Option.isNone(key)) return "invalid";

    return yield* serialized(
      Effect.gen(function* () {
        const before = yield* Ref.get(saved);
        const sameKey = Option.contains(before.key, key.value);
        const confirmed = yield* confirm(key.value, sameKey ? before.activation : Option.none());
        const result = checkOf(confirmed.answer);

        if (result === "invalid") return result;

        // A new key replaces the old one, whose Mac is freed for another; one cutfac.com can't
        // free now is freed when the old key is entered again and finds it unactivated.
        if (!sameKey) {
          const old = Option.all({ key: before.key, activation: before.activation });

          if (Option.isSome(old)) yield* online(deactivateMac(old.value.key, old.value.activation));
        }

        // An unconfirmed new key stays on the free version until cutfac.com answers for it.
        const last = sameKey ? before.record : Option.none();

        yield* keep(
          key.value,
          Option.orElse(confirmed.answer, () => last),
          confirmed.activation,
        );

        return result;
      }),
    );
  });

  const deactivate = Effect.fn("License.deactivate")(function* (): Effect.fn.Return<
    Deactivation,
    LicenseNotSaved
  > {
    return yield* serialized(
      Effect.gen(function* () {
        const { key, activation } = yield* Ref.get(saved);
        const held = Option.all({ key, activation });

        if (Option.isSome(held)) {
          const freed = yield* online(deactivateMac(held.value.key, held.value.activation));

          // Forgetting the key without freeing the Mac would leave it counted against the license.
          if (Option.isNone(freed)) return "unavailable";
        }

        yield* Ref.set(saved, {
          key: Option.none(),
          record: Option.none(),
          activation: Option.none(),
        });
        yield* settings.clear;
        yield* publish;

        return "deactivated";
      }),
    );
  });

  const refresh = Effect.gen(function* () {
    yield* publish;

    const { key, record } = yield* Ref.get(saved);
    const now = yield* Clock.currentTimeMillis;

    const recent = Option.exists(
      yield* Ref.get(askedAt),
      (at) => now - at < Duration.toMillis(ASK_AGAIN_AFTER),
    );

    // A key that names no license won't name one later; a new key goes through `setKey`.
    if (Option.isNone(key) || (yield* Ref.get(paid)) || checkOf(record) === "invalid" || recent)
      return;

    yield* check;
  });

  const updatesEnd = Effect.flatMap(Ref.get(saved), updatesUntil);

  const coveredBy = (releasedAt: number) =>
    Effect.map(updatesEnd, (end) =>
      Option.match(end, { onNone: () => true, onSome: (until) => releasedAt <= until }),
    );

  const covers = Effect.fn("License.covers")(function* (releasedAt: number) {
    if (yield* coveredBy(releasedAt)) return true;

    yield* check;

    return yield* coveredBy(releasedAt);
  });

  const renewal = (locale: string) =>
    Effect.flatMap(Ref.get(saved), ({ key }) =>
      Option.match(key, {
        onNone: () => Effect.succeedNone,
        onSome: (held) => online(renewalCheckout(held, locale)),
      }),
    );

  return License.of({
    setKey,
    refresh,
    hasKey: Effect.map(Ref.get(saved), ({ key }) => Option.isSome(key)),
    deactivate: deactivate(),
    updatesEnd,
    covers,
    renewal,
  });
});
