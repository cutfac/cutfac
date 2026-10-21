/**
 * A drag that says nothing aloud, for one that a menu also does: the menu is the way to move
 * without a mouse, and it names the places itself.
 */
export const QUIET_DRAG = {
  announcements: {
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  },
  screenReaderInstructions: { draggable: "" },
};
