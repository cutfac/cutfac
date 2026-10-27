import { Context, Effect, Layer, Option, Ref } from "effect";
import type { BrowserWindow } from "electron";

import type { Locale } from "../web/src/i18n/locale.ts";

export class AppState extends Context.Service<
  AppState,
  {
    readonly quitting: Ref.Ref<boolean>;
    readonly window: Ref.Ref<Option.Option<BrowserWindow>>;
    readonly workspace: Ref.Ref<Option.Option<string>>;
    readonly origin: Ref.Ref<string>;
    readonly switching: Ref.Ref<boolean>;
    readonly locale: Ref.Ref<Locale>;
  }
>()("cutfac/desktop/AppState") {
  static readonly make = Effect.all({
    quitting: Ref.make(false),
    window: Ref.make(Option.none<BrowserWindow>()),
    workspace: Ref.make(Option.none<string>()),
    origin: Ref.make(""),
    switching: Ref.make(false),
    locale: Ref.make<Locale>("en"),
  }).pipe(Effect.map(AppState.of));

  static readonly layer = Layer.effect(AppState, AppState.make);
}
