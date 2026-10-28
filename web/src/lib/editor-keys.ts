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
  MarkIn: {};
  MarkOut: {};
  Loop: {};
  Step: { readonly seconds: number };
  Clear: {};
}>;

export const EditorKey = Data.taggedEnum<EditorKey>();

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

    case "KeyI":
      return Option.some(EditorKey.MarkIn());

    case "KeyO":
      return Option.some(EditorKey.MarkOut());

    case "KeyL":
      return Option.some(EditorKey.Loop());

    case "ArrowLeft":
    case "ArrowRight": {
      const seconds = (event.code === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1);

      return onControl ? Option.none() : Option.some(EditorKey.Step({ seconds }));
    }

    case "Escape":
      return Option.some(EditorKey.Clear());

    default:
      return Option.none();
  }
}
