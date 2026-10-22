import type { KeyboardEvent } from "react";

export { cn } from "cn";

/** Only http(s) URLs may reach an `href`, so a `javascript:` or `data:` source can't sneak in. */
export function safeHttpUrl(url: string): string | undefined {
  try {
    const { protocol } = new URL(url);

    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Enter while an IME is composing (Korean, Japanese, …) confirms the syllable, not the message. */
export const composing = (event: KeyboardEvent<HTMLElement>) =>
  event.nativeEvent.isComposing || event.keyCode === 229;
