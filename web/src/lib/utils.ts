import { Option, Schema } from "effect";
import type { KeyboardEvent } from "react";

export { cn } from "cn";

export const urlOf = Schema.decodeOption(Schema.URLFromString);

/** Only http(s) URLs may reach an `href`, so a `javascript:` or `data:` source can't sneak in. */
export const safeHttpUrl = (url: string) =>
  urlOf(url).pipe(
    Option.filter(({ protocol }) => protocol === "http:" || protocol === "https:"),
    Option.as(url),
  );

export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Enter while an IME is composing (Korean, Japanese, …) confirms the syllable, not the message. */
export const composing = (event: KeyboardEvent<HTMLElement>) =>
  event.nativeEvent.isComposing || event.keyCode === 229;

interface TextKeys {
  readonly onEnter: () => void;
  readonly onEscape?: (event: KeyboardEvent<HTMLElement>) => void;
}

/** A text box's keys: Enter sends and Shift+Enter starts a new line. */
export const sendOnEnter =
  ({ onEnter, onEscape }: TextKeys) =>
  (event: KeyboardEvent<HTMLElement>) => {
    if (composing(event)) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onEnter();
    } else if (event.key === "Escape") onEscape?.(event);
  };

export const blurOnEscape = (event: KeyboardEvent<HTMLElement>) => event.currentTarget.blur();
