import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

/**
 * Text inside selects like a document, though the rest of the board doesn't. Wrap what people
 * read and might paste elsewhere: a message list, a guide, an error. See docs/ui.md.
 *
 * It adds behavior, not looks, so it sits outside components/ui and takes classes like a plain
 * element, on itself or on the element it renders.
 */
export function SelectionArea({ render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ className: "select-text" }, props),
    render,
  });
}
