import { Context, Effect, Layer, Option, Ref } from "effect";
import type { BrowserWindow } from "electron";

import type { Locale } from "../web/src/i18n/locale.ts";

/** What the main process knows about itself as it runs. */
export class AppState extends Context.Service<
  AppState,
  {
    readonly quitting: Ref.Ref<boolean>;
    /** The board's window, once it is open. */
    readonly window: Ref.Ref<Option.Option<BrowserWindow>>;
    /** The workspace open now; none while the first launch's steps are up. */
    readonly workspace: Ref.Ref<Option.Option<string>>;
    /** Where the board shown now is served from, the only pages that may call the app. */
    readonly origin: Ref.Ref<string>;
    /** A workspace is starting, so the page still shown belongs to the one before. */
    readonly switching: Ref.Ref<boolean>;
    /** The board's language, for the app's own menus and dialogs. */
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
