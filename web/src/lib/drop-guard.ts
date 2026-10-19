/** Files dragged in from the desktop, not text or a link dragged within the page. */
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true;

/** Drop areas carry this attribute; a file may only be let go over one of them. */
const DROP_TARGET = "[data-drop-target]";

/**
 * A file let go anywhere but a drop area would open in the window and replace the board. Outside
 * the drop areas the drag shows that the file will not go in, and a drop there does nothing.
 */
export function installDropGuard() {
  addEventListener("dragover", (event: DragEvent) => {
    if (!carriesFiles(event) || event.dataTransfer === null) return;

    event.preventDefault();

    if (!(event.target instanceof Element && event.target.closest(DROP_TARGET) !== null)) {
      event.dataTransfer.dropEffect = "none";
    }
  });

  addEventListener("drop", (event: DragEvent) => {
    if (carriesFiles(event)) event.preventDefault();
  });
}
