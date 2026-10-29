import { Data, Option } from "effect";

/** Where typing goes to the element, so the editor's single-key shortcuts stay out of the way. */
const TEXT_ENTRY =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='listbox'], [role='menu']";

/** Controls that Space and the arrow keys already operate. */
const CONTROL =
  "button, a[href], [role='button'], [role='tab'], [role='option'], [role='slider'], [role='separator']";

const within = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null;

/** What one of the editor's single-key shortcuts asks for. */
export type EditorKey = Data.TaggedEnum<{
  Shortcuts: {};
  PlayPause: {};
  Mute: {};
  MarkIn: {};
  MarkOut: {};
  Loop: {};
  Step: { readonly frames: number };
  /** Jump to the video's start or end, or to the selection's in or out point. */
  Go: { readonly to: "start" | "end" | "in" | "out" };
  Clear: {};
}>;

export const EditorKey = Data.taggedEnum<EditorKey>();

/** Where a `Go` key lands, in seconds; none when the selection has no such edge. */
export const goTime = (
  to: "start" | "end" | "in" | "out",
  duration: number,
  selection: { readonly start?: number | undefined; readonly end?: number | undefined },
): Option.Option<number> =>
  Option.fromUndefinedOr({ start: 0, end: duration, in: selection.start, out: selection.end }[to]);

/** The shortcut a key press is, if any: none while typing, or with a modifier held. */
export function editorKey(event: KeyboardEvent): Option.Option<EditorKey> {
  if (event.metaKey || event.ctrlKey || event.altKey || within(event.target, TEXT_ENTRY)) {
    return Option.none();
  }

  // `?` is Shift and a different key on each layout, so it goes by the character.
  if (event.key === "?") return Option.some(EditorKey.Shortcuts());

  const onControl = within(event.target, CONTROL);

  switch (event.code) {
    case "Space":
      return onControl ? Option.none() : Option.some(EditorKey.PlayPause());

    case "KeyM":
      return Option.some(EditorKey.Mute());

    case "KeyI":
      return Option.some(event.shiftKey ? EditorKey.Go({ to: "in" }) : EditorKey.MarkIn());

    case "KeyO":
      return Option.some(event.shiftKey ? EditorKey.Go({ to: "out" }) : EditorKey.MarkOut());

    case "Home":
      return Option.some(EditorKey.Go({ to: "start" }));

    case "End":
      return Option.some(EditorKey.Go({ to: "end" }));

    case "KeyL":
      return Option.some(EditorKey.Loop());

    case "ArrowLeft":
    case "ArrowRight": {
      // A frame, or ten with Shift, as in Final Cut Pro.
      const frames = (event.code === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1);

      return onControl ? Option.none() : Option.some(EditorKey.Step({ frames }));
    }

    case "Escape":
      return Option.some(EditorKey.Clear());

    default:
      return Option.none();
  }
}
