import type { Layout, LayoutChangedMeta, PanelImperativeHandle } from "react-resizable-panels";

import type { Want } from "../../lib/dock-panels.ts";
import { updateLayout } from "../../lib/editor-layout-store.ts";
import { withSize } from "../../lib/editor-layout.ts";

/** The pixels a panel's group shares out among its panels, along the group's axis. */
function room(want: Want) {
  const siblings = document.getElementById(want.panel)?.parentElement?.children ?? [];
  let total = 0;

  for (const sibling of siblings) {
    if (!(sibling instanceof HTMLElement) || !sibling.hasAttribute("data-panel")) continue;

    total += want.vertical ? sibling.offsetHeight : sibling.offsetWidth;
  }

  return total;
}

/**
 * Size each panel as wanted. Returns the groups to look at again once the panel library has caught
 * up: those whose panels are not there to size yet, and those just sized, to see the size held.
 */
function enforce(wants: readonly Want[], handles: ReadonlyMap<string, PanelImperativeHandle>) {
  const again = new Set<string>();

  for (const want of wants) {
    const handle = handles.get(want.panel);
    const total = room(want);

    if (handle === undefined || total <= 0) {
      again.add(want.group);
      continue;
    }

    const share = want.unit === "px" ? (want.size / total) * 100 : want.size;

    try {
      const before = handle.getSize().asPercentage;

      // A pixel off is as good as there; a size the group's limits squeeze stays squeezed.
      if ((Math.abs(before - share) * total) / 100 <= 1) continue;

      handle.resize(want.unit === "px" ? want.size : `${want.size}%`);

      if (handle.getSize().asPercentage !== before) again.add(want.group);
    } catch {
      // The group has not registered the panel yet.
      again.add(want.group);
    }
  }

  return again;
}

const panelsOf = (list: readonly Want[]) => list.map((want) => want.panel).join();

/**
 * Holds panels to their sizes. A panel library group remembers the sizes it last had for the same
 * panels, so a size that changes from outside a drag (a reset, another window, a section moving
 * back) is applied to the panel directly, once for each change.
 */
export function createSizer() {
  const handles = new Map<string, PanelImperativeHandle>();
  const refs = new Map<string, (handle: PanelImperativeHandle | null) => void>();
  const seen = new Map<string, Layout>();
  const pending = new Set<string>();
  let wants: readonly Want[] = [];
  let enforced = new Map<string, string>();
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tries = 0;

  const inGroups = (groups: ReadonlySet<string>) => wants.filter((want) => groups.has(want.group));

  function run() {
    timer = undefined;

    const groups = new Set(pending);

    pending.clear();

    const again = enforce(inGroups(groups), handles);

    tries = again.size === 0 ? 0 : tries + 1;

    // Give up on a panel that never shows up or never holds its size rather than try every frame.
    if (again.size > 0 && tries < 10) schedule(again);
  }

  /*
   * The panel library learns a group's new size from a resize observer, which runs after the
   * frame's animation callbacks. A panel sized before then is sized against the group's old size
   * and lands wrong once the library catches up, so the sizing waits for the frame to finish.
   */
  function schedule(groups: Iterable<string>) {
    for (const group of groups) pending.add(group);

    if (frame !== 0 || timer !== undefined) return;

    frame = requestAnimationFrame(() => {
      frame = 0;
      timer = setTimeout(run);
    });
  }

  return {
    /** A ref for the panel's handle, the same one each time. */
    keep(panel: string) {
      let ref = refs.get(panel);

      if (ref === undefined) {
        ref = (handle) => {
          if (handle === null) handles.delete(panel);
          else handles.set(panel, handle);
        };

        refs.set(panel, ref);
      }

      return ref;
    },

    /** Hold the panels to these sizes, sizing the groups whose sizes changed. */
    want(next: readonly Want[]) {
      /*
       * Sections came or went. The limits they set the other panels change with them, and a panel
       * the old limits squeezed, as the window narrowed, stays squeezed once they ease unless it is
       * sized again after the panel library has taken the new limits in.
       */
      const rearranged = panelsOf(next) !== panelsOf(wants);

      wants = next;

      const signatures = new Map<string, string>();

      for (const want of next) {
        signatures.set(want.group, (signatures.get(want.group) ?? "") + JSON.stringify(want));
      }

      const changed = new Set<string>();

      for (const [group, signature] of signatures) {
        if (enforced.get(group) !== signature) changed.add(group);
      }

      enforced = signatures;

      const again = changed.size === 0 ? new Set<string>() : enforce(inGroups(changed), handles);

      if (rearranged) for (const group of signatures.keys()) again.add(group);

      if (again.size === 0) return;

      tries = 0;
      schedule(again);
    },

    /** Size the groups again after the next frame. */
    schedule,

    /** Keep the sizes the user dragged the group's borders to. */
    changed(group: string, layout: Layout, meta: LayoutChangedMeta) {
      const before = seen.get(group);

      seen.set(group, layout);

      if (!meta.isUserInteraction) return;

      updateLayout((saved) => {
        let next = saved;

        for (const want of wants) {
          const share = layout[want.panel];

          if (want.group !== group || !want.save || share === undefined) continue;

          // Only the panels at the dragged border; one the drag left alone keeps its saved size.
          if (before !== undefined && Math.abs((before[want.panel] ?? -1) - share) <= 0.01)
            continue;

          next = withSize(next, want.key, want.unit === "px" ? (share / 100) * room(want) : share);
        }

        return next;
      });
    },

    /** Stop sizing. Sizes wanted again afterwards, as on a remount, size every group anew. */
    stop() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = 0;
      timer = undefined;
      tries = 0;
      pending.clear();
      wants = [];
      enforced = new Map();
    },
  };
}

export type Sizer = ReturnType<typeof createSizer>;
