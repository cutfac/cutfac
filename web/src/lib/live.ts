import { Data, Match, Option } from "effect";

/** Where a live load stands. A failed reload keeps what the key last showed as `last`. */
export type LiveState<T> = Data.TaggedEnum<{
  Loading: {};
  Loaded: { readonly data: T };
  Failed: { readonly error: string; readonly last: Option.Option<T> };
}>;

interface LiveStateOf extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: LiveState<this["A"]>;
}

export const LiveState = Data.taggedEnum<LiveStateOf>();

/** What a live load has to show: its data, or what it last showed before a reload failed. */
export const shownOf = <T>(state: LiveState<T>): Option.Option<T> =>
  Match.valueTags(state, {
    Loading: () => Option.none<T>(),
    Loaded: ({ data }) => Option.some(data),
    Failed: ({ last }) => last,
  });

/** A load that failed after `before`, still showing what `before` showed. */
export const failedAfter = <T>(error: string, before: LiveState<T>): LiveState<T> =>
  LiveState.Failed({ error, last: shownOf(before) });
