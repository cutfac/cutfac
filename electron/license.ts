import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Ref,
  Schedule,
  Schema,
  Semaphore,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { LicenseKey, LicenseRecord, grantFor, isPaid, type SavedLicense } from "../src/license.ts";
import type { LicenseCheck } from "../web/src/desktop.ts";

/** Where the app asks whether its key unlocks the paid plan. */
export const LICENSE_URL = "https://cutfac.com/api/license";

const CHECK_TIMEOUT = "8 seconds";

/** While the app runs, it asks again this often. */
const CHECK_EVERY = "1 day";

/** Coming back to the app asks again at most this often. */
const ASK_AGAIN_AFTER = Duration.minutes(1);

// cutfac.com also says when the plan ends and whether it is a trial's, for apps from before grants
// were signed. The signed token says when it ends, and any grant unlocks the same plan.
const GrantReply = Schema.Struct({ token: Schema.NonEmptyString });

/**
 * A key as the board takes it. Keys travel in an HTTP header, which takes visible ASCII only, and
 * Polar's are far shorter than the limit; anything longer is a paste gone wrong.
 */
const decodeKey = Schema.decodeUnknownOption(
  LicenseKey.check(Schema.isMaxLength(128), Schema.isPattern(/^[\x21-\x7e]+$/)),
);

/** The key as typed or pasted, without surrounding space, if it can be one. */
export const licenseKeyFrom = (input: string) => decodeKey(input.trim());

/** cutfac.com couldn't be asked about a key, or gave no clear answer. */
export class LicenseUnanswered extends Schema.TaggedError<LicenseUnanswered>()(
  "LicenseUnanswered",
  { message: Schema.String },
) {}

/** The key and cutfac.com's answer about it couldn't be saved. */
export class LicenseNotSaved extends Schema.TaggedError<LicenseNotSaved>()("LicenseNotSaved", {
  cause: Schema.Defect(),
}) {}

const unanswered = (error: { readonly message: string }) =>
  new LicenseUnanswered({ message: error.message });

/** The grant in cutfac.com's reply, which only counts as an answer if it is signed for `key`. */
const grantIn = Effect.fnUntraced(function* (
  key: LicenseKey,
  response: HttpClientResponse.HttpClientResponse,
) {
  const { token } = yield* HttpClientResponse.filterStatusOk(response).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(GrantReply)),
    Effect.mapError(unanswered),
  );

  if (Option.isNone(yield* grantFor(key, token)))
    return yield* new LicenseUnanswered({ message: "The grant isn't signed for this key" });

  return LicenseRecord.cases.LicenseGrant.make({ token });
});

/**
 * Asks cutfac.com about `key`: a grant, or a refusal for a key that names no license or one whose
 * plan has ended.
 */
export const fetchLicense = Effect.fn("license.fetch")(
  function* (
    key: LicenseKey,
  ): Effect.fn.Return<LicenseRecord, LicenseUnanswered, HttpClient.HttpClient> {
    const response = yield* HttpClient.execute(
      HttpClientRequest.get(LICENSE_URL).pipe(HttpClientRequest.bearerToken(key)),
    ).pipe(Effect.mapError(unanswered));

    const checkedAt = yield* Clock.currentTimeMillis;

    const refusal = (reason: "invalid" | "ended") =>
      Effect.succeed(LicenseRecord.cases.LicenseRefusal.make({ checkedAt, refusal: reason }));

    return yield* Match.value(response.status).pipe(
      Match.when(401, () => refusal("invalid")),
      Match.when(402, () => refusal("ended")),
      Match.orElse(() => grantIn(key, response)),
    );
  },
  Effect.timeoutOrElse({
    duration: CHECK_TIMEOUT,
    orElse: () =>
      Effect.fail(new LicenseUnanswered({ message: "cutfac.com didn't answer in time" })),
  }),
);

/** What the board hears when it gives a key: no answer, or cutfac.com's. */
const checkOf = (answer: Option.Option<LicenseRecord>): LicenseCheck =>
  Option.match(answer, {
    onNone: (): LicenseCheck => "unavailable",
    onSome: LicenseRecord.match({
      LicenseGrant: (): LicenseCheck => "granted",
      LicenseRefusal: ({ refusal }) => refusal,
    }),
  });

/** Where the app keeps the license key and cutfac.com's last answer about it. */
export class LicenseSettings extends Context.Service<
  LicenseSettings,
  {
    readonly load: Effect.Effect<SavedLicense>;
    /** Saves both together; no record drops the old one. */
    save(
      key: LicenseKey,
      record: Option.Option<LicenseRecord>,
    ): Effect.Effect<void, LicenseNotSaved>;
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
  }
>()("cutfac/desktop/License") {
  /**
   * Keeps cutfac.com's answer about the saved key fresh: asks at launch and once a day, and again
   * when the user comes back to a key that doesn't unlock the paid plan, perhaps after renewing or
   * getting online. `changed` tells the board the paid plan unlocked or ran out, once the settings
   * that say so are saved.
   */
  static readonly layer = (changed: Effect.Effect<void>) => Layer.effect(License, make(changed));

  static readonly unavailable = Layer.succeed(
    License,
    License.of({
      setKey: () => Effect.succeed("unavailable"),
      refresh: Effect.void,
      hasKey: Effect.succeed(false),
    }),
  );
}

const make = Effect.fnUntraced(function* (changed: Effect.Effect<void>) {
  const settings = yield* LicenseSettings;
  const client = yield* HttpClient.HttpClient;
  const initial = yield* settings.load;
  const saved = yield* Ref.make(initial);
  const paid = yield* Ref.make(yield* isPaid(initial));
  const askedAt = yield* Ref.make(Option.none<number>());

  // Each check runs after the one before, so an answer about an old key never lands on a new one.
  const serialized = (yield* Semaphore.make(1)).withPermits(1);

  const ask = (key: LicenseKey) =>
    fetchLicense(key).pipe(Effect.provideService(HttpClient.HttpClient, client), Effect.option);

  /** Tells the board when the plan changed, which a grant running out does on its own. */
  const publish = Effect.gen(function* () {
    const next = yield* Effect.flatMap(Ref.get(saved), isPaid);

    if (yield* Ref.modify(paid, (was) => [was !== next, next])) yield* changed;
  });

  const keep = Effect.fnUntraced(function* (key: LicenseKey, record: Option.Option<LicenseRecord>) {
    yield* Ref.set(saved, { key: Option.some(key), record });

    // The board's server reads the plan from the saved settings, so they go first.
    yield* settings.save(key, record);
    yield* publish;
  });

  /** Asks about the saved key. No answer keeps the last one, which holds until its grace runs out. */
  const check = Effect.gen(function* () {
    yield* Ref.set(askedAt, Option.some(yield* Clock.currentTimeMillis));

    yield* serialized(
      Effect.gen(function* () {
        const { key } = yield* Ref.get(saved);

        if (Option.isNone(key)) return;

        const answer = yield* ask(key.value);

        yield* Option.match(answer, {
          onNone: () => publish,
          onSome: (record) => keep(key.value, Option.some(record)),
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
        const answer = yield* ask(key.value);
        const result = checkOf(answer);

        if (result === "invalid") return result;

        const before = yield* Ref.get(saved);

        // An unconfirmed new key stays on the free version until cutfac.com answers for it.
        const last = Option.contains(before.key, key.value) ? before.record : Option.none();

        yield* keep(
          key.value,
          Option.orElse(answer, () => last),
        );

        return result;
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

  return License.of({
    setKey,
    refresh,
    hasKey: Effect.map(Ref.get(saved), ({ key }) => Option.isSome(key)),
  });
});
