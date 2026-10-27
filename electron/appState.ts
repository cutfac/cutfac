import { Context, Effect, Layer, Ref } from "effect";

/** What the main process knows about itself as it runs. */
export class AppState extends Context.Service<
  AppState,
  {
    readonly quitting: Ref.Ref<boolean>;
  }
>()("cutfac/desktop/AppState") {
  static readonly layer = Layer.effect(
    AppState,
    Effect.map(Ref.make(false), (quitting) => AppState.of({ quitting })),
  );
}
