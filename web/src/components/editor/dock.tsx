/**
 * The item editor's frame: the preview in the middle, the media and reference strips around it and
 * the chat panel at one edge. A border between two sections drags to resize them and resets on a
 * double-click; the grip by a section's name drags the section to another place, or opens a menu of
 * the places it can go. One arrangement serves every item, kept in this browser.
 *
 * A strip that moves mounts afresh in its new place. The chat moving to the other edge moves the
 * rest of the editor within the page, which pauses a playing video.
 */

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { GripVerticalIcon } from "lucide-react";
import {
  createContext,
  Fragment,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Layout, LayoutChangedMeta, PanelImperativeHandle } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import { useMessages, type Messages } from "../../i18n/index.ts";
import {
  arrange,
  columnsOf,
  DEFAULT_LAYOUT,
  fitsIn,
  isDefaultLayout,
  mainMinWidth,
  moveChat,
  moveStrip,
  PANEL,
  parseLayout,
  serializeLayout,
  SIDES,
  sizeOf,
  slotOf,
  SLOTS,
  splitKey,
  STRIPS,
  withoutSize,
  withSize,
  type Arrangement,
  type EditorLayout,
  type Side,
  type SizeKey,
  type Slot,
  type StripId,
} from "../../lib/editor-layout.ts";

const STORAGE_KEY = "cutfac.editor.layout";

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked, as in some private windows; the editor starts from the default.
    return null;
  }
}

function writeStored(layout: EditorLayout) {
  try {
    if (isDefaultLayout(layout)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, serializeLayout(layout));
  } catch {
    // Storage can be blocked or full; the arrangement still holds until the page reloads.
  }
}

let current = parseLayout(readStored());

const watchers = new Set<() => void>();

const subscribe = (watcher: () => void) => {
  watchers.add(watcher);

  return () => {
    watchers.delete(watcher);
  };
};

const snapshot = () => current;

function notify() {
  for (const watcher of watchers) watcher();
}

/** Change the arrangement of every item's editor, and keep it. */
function updateLayout(change: (layout: EditorLayout) => EditorLayout) {
  const next = change(current);

  if (next === current) return;

  current = next;
  writeStored(next);
  notify();
}

// Another window of the board moved a section or resized one: follow it.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;

  const next = parseLayout(readStored());

  if (serializeLayout(next) === serializeLayout(current)) return;

  current = next;
  notify();
});

const useEditorLayout = () => useSyncExternalStore(subscribe, snapshot);

/** The element's width, following it as it changes; the window's until there is an element. */
function useWidth(element: HTMLElement | null) {
  const follow = (listener: () => void) => {
    if (element === null) return () => {};

    const observer = new ResizeObserver(listener);

    observer.observe(element);

    return () => observer.disconnect();
  };

  return useSyncExternalStore(follow, () => element?.clientWidth ?? window.innerWidth);
}

/** What has a grip: a strip, or the chat panel. */
type Section = StripId | "chat";

const SLOT_NAME = { bottom: "below", left: "left", right: "right" } as const;

/** The section whose grip takes the focus as it shows up again, in the place its menu moved it to. */
let regrip: Section | undefined;

/**
 * Change the arrangement from a section's menu. A section that moves shows up anew in its new
 * place, without the grip the menu would give the focus back to, so its new grip takes it there.
 */
function updateFromMenu(section: Section, change: (layout: EditorLayout) => EditorLayout) {
  regrip = section;
  updateLayout(change);
  // A section that stayed put keeps its grip, and the menu gives the focus back to it.
  setTimeout(() => {
    regrip = undefined;
  });
}

const nameOf = (section: Section, t: Messages) =>
  section === "chat" ? t.layout.chat : t.attachments[section];

const sectionOf = (id: UniqueIdentifier): Section | undefined =>
  id === "chat" ? "chat" : STRIPS.find((strip) => strip === id);

// The groups' ids name what they hold, so a group that comes back with other panels is sized anew.
const outerGroup = (arrangement: Arrangement) => `dock-outer-${arrangement.chat}`;

const columnsGroup = ({ slots }: Arrangement) =>
  `dock-columns${slots.left.length > 0 ? "-l" : ""}${slots.right.length > 0 ? "-r" : ""}`;

const rowsGroup = ({ slots }: Arrangement) => `dock-rows${slots.bottom.length > 0 ? "-b" : ""}`;

const splitGroup = (slot: Slot, strips: readonly StripId[]) =>
  `dock-split-${slot}-${strips.join("-")}`;

const CHAT_PANEL = "dock-chat";

const slotPanel = (slot: Slot) => `dock-${slot}`;

const stripPanel = (strip: StripId) => `dock-strip-${strip}`;

/** The chat's size: its width beside everything else, or its height below it. */
const chatKeyOf = ({ chat }: Arrangement) => (chat === "below" ? "chat-below" : "chat");

/** A size the editor holds a panel to: what the user dragged its border to, else where it starts. */
interface Want {
  readonly key: SizeKey;
  readonly panel: string;
  readonly group: string;
  /** Whether the group stacks its panels, so the size is a height. */
  readonly vertical: boolean;
  readonly size: number;
  readonly unit: "px" | "%";
  /** Whether a drag of the border is kept; a split made only for a narrow window is not. */
  readonly save: boolean;
}

function wantsFor(layout: EditorLayout, arrangement: Arrangement): Want[] {
  const { slots, folded } = arrangement;
  const chatKey = chatKeyOf(arrangement);

  const wants: Want[] = [
    {
      key: chatKey,
      panel: CHAT_PANEL,
      group: outerGroup(arrangement),
      vertical: arrangement.chat === "below",
      size: sizeOf(layout, arrangement, chatKey),
      unit: "px",
      save: true,
    },
  ];

  for (const side of SIDES) {
    if (slots[side].length === 0) continue;

    wants.push({
      key: side,
      panel: slotPanel(side),
      group: columnsGroup(arrangement),
      vertical: false,
      size: sizeOf(layout, arrangement, side),
      unit: "px",
      save: true,
    });
  }

  if (slots.bottom.length > 0) {
    wants.push({
      key: "bottom",
      panel: slotPanel("bottom"),
      group: rowsGroup(arrangement),
      vertical: true,
      size: sizeOf(layout, arrangement, "bottom"),
      unit: "px",
      save: true,
    });
  }

  for (const slot of SLOTS) {
    const [first, second] = slots[slot];

    if (first === undefined || second === undefined) continue;

    const key = splitKey(slot);

    wants.push({
      key,
      panel: stripPanel(first),
      group: splitGroup(slot, slots[slot]),
      vertical: slot !== "bottom",
      size: sizeOf(layout, arrangement, key),
      unit: "%",
      save: !folded,
    });
  }

  return wants;
}

/** The pixels a panel's group shares out among its panels, along the group's axis. */
function room(want: Want) {
  const siblings = document.getElementById(want.panel)?.parentElement?.children;
  let total = 0;

  if (siblings === undefined) return total;

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

/**
 * Holds panels to their sizes. A panel library group remembers the sizes it last had for the same
 * panels, so a size that changes from outside a drag (a reset, another window, a section moving
 * back) is applied to the panel directly, once for each change.
 */
function createSizer() {
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
  const panelsOf = (list: readonly Want[]) => list.map((want) => want.panel).join();

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

type Sizer = ReturnType<typeof createSizer>;

interface Dock {
  readonly layout: EditorLayout;
  readonly arrangement: Arrangement;
  /** The editor's width in pixels. */
  readonly width: number;
}

const DockContext = createContext<Dock | undefined>(undefined);

const NO_STRIPS: EditorLayout["slots"] = { bottom: [], left: [], right: [] };

interface EditorDockProps {
  toolbar: ReactNode;
  /** The preview with what goes under it, or what shows in its place. */
  stage: ReactNode;
  /** The strips to place around the preview; none while there is nothing to preview. */
  strips?: Readonly<Record<StripId, ReactNode>> | undefined;
  /** The chat panel, which fills the height or width it is given. */
  chat: ReactNode;
}

export function EditorDock({ toolbar, stage, strips, chat }: EditorDockProps) {
  const t = useMessages();
  const layout = useEditorLayout();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const width = useWidth(root);

  // With nothing to preview there are no strips to place.
  const arrangement = arrange(
    strips === undefined ? { ...layout, slots: NO_STRIPS } : layout,
    width,
  );

  const [sizer] = useState(createSizer);
  const wants = wantsFor(layout, arrangement);
  const [dragging, setDragging] = useState<Section | undefined>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useLayoutEffect(() => sizer.want(wants), [sizer, wants]);

  useEffect(() => () => sizer.stop(), [sizer]);

  const border = (key: SizeKey, group: string, variant: "line" | "gap") => (
    <ResizableHandle
      variant={variant}
      withHandle={variant === "gap"}
      disableDoubleClick
      title={t.layout.resize}
      onDoubleClick={() => {
        updateLayout((saved) => withoutSize(saved, key));
        sizer.schedule([group]);
      }}
    />
  );

  const drop = ({ active, over }: DragEndEvent) => {
    setDragging(undefined);

    const section = sectionOf(active.id);

    if (over === null || section === undefined) return;

    if (section === "chat") {
      const side = SIDES.find((edge) => over.id === `chat-${edge}`);

      if (side !== undefined) updateLayout((saved) => moveChat(saved, side));

      return;
    }

    const zone = stripZones(layout, section, width).find(
      (candidate) => candidate.id === over.id && !candidate.disabled,
    );

    if (zone === undefined) return;

    updateLayout((saved) => moveStrip(saved, section, zone.slot, zone.index));
  };

  const below = arrangement.chat === "below";
  const outer = outerGroup(arrangement);
  const chatKey = chatKeyOf(arrangement);
  const columns = columnsOf(arrangement);

  const chatPanel = (
    <ResizablePanel
      key="chat"
      id={CHAT_PANEL}
      panelRef={sizer.keep(CHAT_PANEL)}
      defaultSize={sizeOf(layout, arrangement, chatKey)}
      minSize={below ? PANEL.chatBelow.min : PANEL.chat.min}
      groupResizeBehavior="preserve-pixel-size"
      className="flex min-h-0 flex-col"
    >
      {chat}
    </ResizablePanel>
  );

  const mainPanel = (
    <ResizablePanel
      key="main"
      id="dock-main"
      minSize={below ? PANEL.stacked.min : mainMinWidth(columns)}
      className="flex min-h-0 min-w-0 flex-col"
    >
      <section className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {toolbar}
        <div className="relative flex min-h-0 flex-1">
          {strips === undefined ? (
            stage
          ) : (
            <Columns
              arrangement={arrangement}
              layout={layout}
              sizer={sizer}
              stage={stage}
              strips={strips}
              border={border}
            />
          )}
          {strips !== undefined && dragging !== undefined && dragging !== "chat" && (
            <StripZones layout={layout} strip={dragging} width={width} />
          )}
        </div>
      </section>
    </ResizablePanel>
  );

  const chatBorder = <Fragment key="chat-border">{border(chatKey, outer, "line")}</Fragment>;

  return (
    <div ref={setRoot} className="relative flex min-h-0 min-w-0 flex-1">
      {root !== null && (
        <DockContext value={{ layout, arrangement, width }}>
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            autoScroll={false}
            accessibility={QUIET}
            onDragStart={({ active }: DragStartEvent) => setDragging(sectionOf(active.id))}
            onDragCancel={() => setDragging(undefined)}
            onDragEnd={drop}
          >
            <ResizablePanelGroup
              id={outer}
              orientation={below ? "vertical" : "horizontal"}
              onLayoutChanged={(next, meta) => sizer.changed(outer, next, meta)}
            >
              {arrangement.chat === "left"
                ? [chatPanel, chatBorder, mainPanel]
                : [mainPanel, chatBorder, chatPanel]}
            </ResizablePanelGroup>
            {dragging === "chat" && <ChatZones />}
            <DragOverlay dropAnimation={null}>
              {dragging !== undefined && <DragChip name={nameOf(dragging, t)} />}
            </DragOverlay>
          </DndContext>
        </DockContext>
      )}
    </div>
  );
}

/**
 * A section drag says nothing aloud: the grip's menu is the way to move a section without a mouse,
 * and it names the places itself.
 */
const QUIET = {
  announcements: {
    onDragStart: () => undefined,
    onDragOver: () => undefined,
    onDragEnd: () => undefined,
    onDragCancel: () => undefined,
  },
  screenReaderInstructions: { draggable: "" },
};

interface ColumnsProps {
  arrangement: Arrangement;
  layout: EditorLayout;
  sizer: Sizer;
  stage: ReactNode;
  strips: Readonly<Record<StripId, ReactNode>>;
  border: (key: SizeKey, group: string, variant: "line" | "gap") => ReactNode;
}

/**
 * The preview with the strips around it. The preview's panel keeps its place in the tree whatever
 * moves around it, so a playing video plays on.
 */
function Columns({ arrangement, layout, sizer, stage, strips, border }: ColumnsProps) {
  const { slots } = arrangement;
  const columns = columnsGroup(arrangement);
  const rows = rowsGroup(arrangement);

  const side = (slot: Side) => (
    <ResizablePanel
      id={slotPanel(slot)}
      panelRef={sizer.keep(slotPanel(slot))}
      defaultSize={sizeOf(layout, arrangement, slot)}
      minSize={PANEL.column.min}
      groupResizeBehavior="preserve-pixel-size"
      className="flex min-h-0 min-w-0 flex-col"
    >
      <Slotted slot={slot} {...{ arrangement, layout, sizer, strips, border }} />
    </ResizablePanel>
  );

  return (
    <ResizablePanelGroup
      id={columns}
      orientation="horizontal"
      onLayoutChanged={(next, meta) => sizer.changed(columns, next, meta)}
    >
      {[
        slots.left.length > 0 && (
          <Fragment key="left">
            {side("left")}
            {border("left", columns, "gap")}
          </Fragment>
        ),
        <ResizablePanel
          key="center"
          id="dock-center"
          minSize={PANEL.center.min}
          className="flex min-h-0 min-w-0 flex-col"
        >
          <ResizablePanelGroup
            id={rows}
            orientation="vertical"
            onLayoutChanged={(next, meta) => sizer.changed(rows, next, meta)}
          >
            {[
              <ResizablePanel
                key="stage"
                id="dock-stage"
                minSize={PANEL.stage.min}
                className="flex min-h-0 flex-col"
              >
                <div className="flex min-h-0 flex-1 flex-col gap-3">{stage}</div>
              </ResizablePanel>,
              slots.bottom.length > 0 && (
                <Fragment key="bottom">
                  {border("bottom", rows, "gap")}
                  <ResizablePanel
                    id={slotPanel("bottom")}
                    panelRef={sizer.keep(slotPanel("bottom"))}
                    defaultSize={sizeOf(layout, arrangement, "bottom")}
                    minSize={PANEL.bottom.min}
                    groupResizeBehavior="preserve-pixel-size"
                    className="flex min-h-0 min-w-0 flex-col"
                  >
                    <Slotted slot="bottom" {...{ arrangement, layout, sizer, strips, border }} />
                  </ResizablePanel>
                </Fragment>
              ),
            ]}
          </ResizablePanelGroup>
        </ResizablePanel>,
        slots.right.length > 0 && (
          <Fragment key="right">
            {border("right", columns, "gap")}
            {side("right")}
          </Fragment>
        ),
      ]}
    </ResizablePanelGroup>
  );
}

/** The strips in one slot: one fills it, two share it with a border between them. */
function Slotted({
  slot,
  arrangement,
  layout,
  sizer,
  strips,
  border,
}: Omit<ColumnsProps, "stage"> & { slot: Slot }) {
  const ids = arrangement.slots[slot];
  const [first, second] = ids;

  if (first === undefined) return null;

  if (second === undefined) return <StripBox strip={first}>{strips[first]}</StripBox>;

  const group = splitGroup(slot, ids);
  const key = splitKey(slot);
  const minSize = slot === "bottom" ? PANEL.strip.minWidth : PANEL.strip.minHeight;

  return (
    <ResizablePanelGroup
      id={group}
      orientation={slot === "bottom" ? "horizontal" : "vertical"}
      onLayoutChanged={(next, meta) => sizer.changed(group, next, meta)}
    >
      <ResizablePanel
        id={stripPanel(first)}
        panelRef={sizer.keep(stripPanel(first))}
        defaultSize={`${sizeOf(layout, arrangement, key)}%`}
        minSize={minSize}
        className="flex min-h-0 min-w-0 flex-col"
      >
        <StripBox strip={first}>{strips[first]}</StripBox>
      </ResizablePanel>
      {border(key, group, "gap")}
      <ResizablePanel
        id={stripPanel(second)}
        minSize={minSize}
        className="flex min-h-0 min-w-0 flex-col"
      >
        <StripBox strip={second}>{strips[second]}</StripBox>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * A strip in its place, with its grip at the corner of its title. Its tiles wrap and scroll down,
 * so a strip reads the same below the preview as in a column beside it.
 */
function StripBox({ strip, children }: { strip: StripId; children: ReactNode }) {
  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col [&_[data-slot=dropzone]>div:not([data-slot])]:min-h-0 [&_[data-slot=dropzone]>div:not([data-slot])]:flex-wrap [&_[data-slot=dropzone]>div:not([data-slot])]:content-start [&_[data-slot=dropzone]>div:not([data-slot])]:overflow-y-auto [&>[data-slot=dropzone]]:min-h-0">
      {children}
      <div className="absolute top-0 right-0 z-10">
        <SectionGrip section={strip} />
      </div>
    </div>
  );
}

interface StripZone {
  readonly id: string;
  readonly slot: Slot;
  /** Where among the slot's other strips the dragged one goes. */
  readonly index: number;
  /** The window is too narrow to show the strip there. */
  readonly disabled: boolean;
}

/** The places a dragged strip can go: before, between or after the strips in each slot. */
function stripZones(layout: EditorLayout, strip: StripId, width: number) {
  const zones: StripZone[] = [];

  for (const slot of SLOTS) {
    const others = layout.slots[slot].filter((other) => other !== strip).length;

    for (let index = 0; index <= others; index++) {
      const disabled = !fitsIn(layout, strip, slot, width, index);

      zones.push({ id: `strip-${slot}-${index}`, slot, index, disabled });
    }
  }

  return zones;
}

const BAND: Readonly<Record<Slot, string>> = {
  left: "absolute inset-y-0 left-0 flex w-[22%] flex-col gap-2",
  right: "absolute inset-y-0 right-0 flex w-[22%] flex-col gap-2",
  bottom: "absolute right-[22%] bottom-0 left-[22%] flex h-[30%] gap-2",
};

/** Where a dragged strip can land, over the preview and the strips. */
function StripZones({
  layout,
  strip,
  width,
}: {
  layout: EditorLayout;
  strip: StripId;
  width: number;
}) {
  const t = useMessages();
  const zones = stripZones(layout, strip, width);

  return (
    <div className="absolute inset-0 z-40 cursor-grabbing">
      {SLOTS.map((slot) => {
        const parts: ReactNode[] = [];

        for (const zone of zones) {
          if (zone.slot !== slot) continue;

          parts.push(
            <Zone key={zone.id} id={zone.id} disabled={zone.disabled}>
              {zone.disabled ? t.layout.narrow : t.layout[SLOT_NAME[slot]]}
            </Zone>,
          );
        }

        return (
          <div key={slot} className={BAND[slot]}>
            {parts}
          </div>
        );
      })}
    </div>
  );
}

/** Where the dragged chat panel can land: either edge of the editor. */
function ChatZones() {
  const t = useMessages();

  return (
    <div className="absolute inset-0 z-40 cursor-grabbing">
      <div className="absolute inset-y-0 left-0 flex w-1/4 p-2">
        <Zone id="chat-left">{t.layout.leftEdge}</Zone>
      </div>
      <div className="absolute inset-y-0 right-0 flex w-1/4 p-2">
        <Zone id="chat-right">{t.layout.rightEdge}</Zone>
      </div>
    </div>
  );
}

function Zone({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      data-over={isOver}
      data-disabled={disabled || undefined}
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-lg border-2 border-dashed border-dock/60 bg-dock/10 p-2 data-[disabled]:opacity-40 data-[over=true]:border-solid data-[over=true]:border-dock data-[over=true]:bg-dock/20"
    >
      <span className="max-w-full truncate rounded-full bg-background px-3 py-1 text-xs font-medium text-dock shadow-sm">
        {children}
      </span>
    </div>
  );
}

/** What follows the pointer while a section is dragged: its name, ending at the grip. */
function DragChip({ name }: { name: string }) {
  return (
    <div className="relative size-full">
      <div className="absolute inset-y-0 right-0 flex items-center gap-1.5 rounded-full bg-popover px-2.5 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-lg ring-2 ring-dock">
        <GripVerticalIcon className="size-3.5" />
        {name}
      </div>
    </div>
  );
}

/** The handle by a section's name: drag it to move the section, or click it for a menu of places. */
export function SectionGrip({ section }: { section: Section }) {
  const dock = use(DockContext);

  if (dock === undefined) return null;

  return <Grip section={section} dock={dock} />;
}

function Grip({ section, dock }: { section: Section; dock: Dock }) {
  const t = useMessages();
  const stacked = dock.arrangement.chat === "below";

  // The chat has nowhere else to go while it is stacked below.
  const { listeners, node, setNodeRef } = useDraggable({
    id: section,
    disabled: section === "chat" && stacked,
  });

  useEffect(() => {
    if (regrip !== section) return;

    regrip = undefined;
    node.current?.focus();
  }, [node, section]);

  const [open, setOpen] = useState(false);
  const wasOpen = useRef(false);
  const dragged = useRef(false);
  const name = nameOf(section, t);

  useDndMonitor({
    onDragStart: ({ active }) => {
      if (active.id === section) dragged.current = true;
    },
  });

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next, details) => {
        // A press on the grip can start a drag, so the menu waits for the click that ends it.
        if (next && details.reason === "trigger-press" && details.event.type === "mousedown") {
          details.cancel();

          return;
        }

        setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        ref={setNodeRef}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t.layout.move(name)}
            className="cursor-grab touch-none"
          />
        }
        onPointerDown={(event) => {
          wasOpen.current = open;
          dragged.current = false;
          listeners?.onPointerDown?.(event);
        }}
        onClick={(event) => {
          // A key press opens the menu on its own; a press that dragged the section is no click.
          if (event.detail !== 0 && !wasOpen.current && !dragged.current) setOpen(true);
        }}
      >
        <GripVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        {section === "chat" ? (
          <ChatPlaces dock={dock} />
        ) : (
          <StripPlaces strip={section} dock={dock} />
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isDefaultLayout(dock.layout)}
          onClick={() => updateFromMenu(section, () => DEFAULT_LAYOUT)}
        >
          {t.layout.reset}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StripPlaces({ strip, dock }: { strip: StripId; dock: Dock }) {
  const t = useMessages();
  const { layout, arrangement, width } = dock;
  const name = nameOf(strip, t);
  const saved = slotOf(layout, strip);
  const sharing = layout.slots[saved];

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{t.layout.place(name)}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={saved}
        onValueChange={(value: string) => {
          const slot = SLOTS.find((candidate) => candidate === value);

          if (slot !== undefined) updateFromMenu(strip, (before) => moveStrip(before, strip, slot));
        }}
      >
        {SLOTS.map((slot) => {
          const fits = slot === saved || fitsIn(layout, strip, slot, width);

          return (
            <DropdownMenuRadioItem key={slot} value={slot} closeOnClick disabled={!fits}>
              <span className="flex flex-col">
                {t.layout[SLOT_NAME[slot]]}
                {!fits && <span className="text-xs text-muted-foreground">{t.layout.narrow}</span>}
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {arrangement.folded && saved !== "bottom" && (
        <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">{t.layout.folded}</p>
      )}
      {sharing.length > 1 && (
        <DropdownMenuItem
          onClick={() =>
            updateFromMenu(strip, (before) =>
              moveStrip(before, strip, saved, sharing.indexOf(strip) === 0 ? 1 : 0),
            )
          }
        >
          {t.layout.swap}
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
  );
}

function ChatPlaces({ dock }: { dock: Dock }) {
  const t = useMessages();
  const stacked = dock.arrangement.chat === "below";

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{t.layout.place(t.layout.chat)}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={dock.layout.chat}
        onValueChange={(value: string) => {
          const side = SIDES.find((candidate) => candidate === value);

          if (side !== undefined) updateFromMenu("chat", (before) => moveChat(before, side));
        }}
      >
        <DropdownMenuRadioItem value="left" closeOnClick disabled={stacked}>
          {t.layout.leftEdge}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="right" closeOnClick disabled={stacked}>
          {t.layout.rightEdge}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {stacked && (
        <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">{t.layout.folded}</p>
      )}
    </DropdownMenuGroup>
  );
}
