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
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Option } from "effect";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import { useMessages } from "../../i18n/index.ts";
import {
  CHAT_PANEL,
  chatKeyOf,
  columnsGroup,
  outerGroup,
  rowsGroup,
  slotPanel,
  splitGroup,
  stripPanel,
  wantsFor,
} from "../../lib/dock-panels.ts";
import { dropOn, sectionOf, type Section } from "../../lib/dock-zones.ts";
import { QUIET_DRAG } from "../../lib/drag.ts";
import { updateLayout, useEditorLayout } from "../../lib/editor-layout-store.ts";
import {
  arrange,
  columnsOf,
  mainMinWidth,
  PANEL,
  sizeOf,
  splitKey,
  withoutSize,
  type Arrangement,
  type EditorLayout,
  type SizeKey,
  type Slot,
  type StripId,
} from "../../lib/editor-layout.ts";
import { DockContext, nameOf } from "./dock-context.ts";
import { SectionGrip } from "./dock-grip.tsx";
import { createSizer, type Sizer } from "./dock-sizer.ts";
import { ChatZones, DragChip, StripZones } from "./dock-zones.tsx";

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

type Strips = Readonly<Partial<Record<StripId, ReactNode>>>;

/** The layout's slots with only the strips that have something to show. */
const shownSlots = ({ bottom, left, right }: EditorLayout["slots"], strips: Strips) => {
  const shown = (id: StripId) => strips[id] !== undefined;

  return { bottom: bottom.filter(shown), left: left.filter(shown), right: right.filter(shown) };
};

interface EditorDockProps {
  /** The preview with what goes under it, or what shows in its place. */
  stage: ReactNode;
  /** The strips to place around the preview; one left out takes no room. */
  strips: Strips;
  /** The chat panel, which fills the height or width it is given. */
  chat: ReactNode;
}

export function EditorDock({ stage, strips, chat }: EditorDockProps) {
  const t = useMessages();
  const layout = useEditorLayout();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const width = useWidth(root);

  const arrangement = arrange({ ...layout, slots: shownSlots(layout.slots, strips) }, width);

  const [sizer] = useState(createSizer);
  const wants = wantsFor(layout, arrangement);
  const [dragging, setDragging] = useState<Section | undefined>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useLayoutEffect(() => sizer.want(wants), [sizer, wants]);

  useEffect(() => () => sizer.stop(), [sizer]);

  const drop = ({ active, over }: DragEndEvent) => {
    setDragging(undefined);

    const section = sectionOf(active.id);

    if (over === null || Option.isNone(section)) return;

    updateLayout((saved) => dropOn(saved, section.value, over.id, width));
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
      <section className="flex min-h-0 flex-1 flex-col p-4 pt-1">
        <div className="relative flex min-h-0 flex-1">
          {/* Always in its panel, so a strip appearing beside it leaves a playing video playing. */}
          <Columns
            arrangement={arrangement}
            layout={layout}
            sizer={sizer}
            stage={stage}
            strips={strips}
          />
          {dragging !== undefined && dragging !== "chat" && (
            <StripZones layout={layout} strip={dragging} width={width} />
          )}
        </div>
      </section>
    </ResizablePanel>
  );

  const chatBorder = (
    <Border key="chat-border" sizeKey={chatKey} group={outer} variant="line" sizer={sizer} />
  );

  return (
    <div ref={setRoot} className="relative flex min-h-0 min-w-0 flex-1">
      {root !== null && (
        <DockContext value={{ layout, arrangement, width }}>
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            autoScroll={false}
            // The grip's menu moves a section without a mouse.
            accessibility={QUIET_DRAG}
            onDragStart={({ active }: DragStartEvent) =>
              setDragging(Option.getOrUndefined(sectionOf(active.id)))
            }
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

interface BorderProps {
  sizeKey: SizeKey;
  group: string;
  variant: "line" | "gap";
  sizer: Sizer;
}

function Border({ sizeKey, group, variant, sizer }: BorderProps) {
  const t = useMessages();

  return (
    <ResizableHandle
      variant={variant}
      withHandle={variant === "gap"}
      disableDoubleClick
      title={t.layout.resize}
      onDoubleClick={() => {
        updateLayout((saved) => withoutSize(saved, sizeKey));
        sizer.schedule([group]);
      }}
    />
  );
}

interface SlotProps {
  arrangement: Arrangement;
  layout: EditorLayout;
  sizer: Sizer;
  strips: Strips;
}

/**
 * The preview with the strips around it. The preview's panel keeps its place in the tree whatever
 * moves around it, so a playing video plays on.
 */
function Columns({ stage, ...shared }: SlotProps & { stage: ReactNode }) {
  const { arrangement, sizer } = shared;
  const { slots } = arrangement;
  const columns = columnsGroup(arrangement);
  const rows = rowsGroup(arrangement);

  return (
    <ResizablePanelGroup
      id={columns}
      orientation="horizontal"
      onLayoutChanged={(next, meta) => sizer.changed(columns, next, meta)}
    >
      {[
        slots.left.length > 0 && (
          <Fragment key="left">
            <SlotPanel slot="left" minSize={PANEL.column.min} {...shared} />
            <Border sizeKey="left" group={columns} variant="gap" sizer={sizer} />
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
                  <Border sizeKey="bottom" group={rows} variant="gap" sizer={sizer} />
                  <SlotPanel slot="bottom" minSize={PANEL.bottom.min} {...shared} />
                </Fragment>
              ),
            ]}
          </ResizablePanelGroup>
        </ResizablePanel>,
        slots.right.length > 0 && (
          <Fragment key="right">
            <Border sizeKey="right" group={columns} variant="gap" sizer={sizer} />
            <SlotPanel slot="right" minSize={PANEL.column.min} {...shared} />
          </Fragment>
        ),
      ]}
    </ResizablePanelGroup>
  );
}

function SlotPanel({ slot, minSize, ...shared }: SlotProps & { slot: Slot; minSize: number }) {
  const { arrangement, layout, sizer } = shared;

  return (
    <ResizablePanel
      id={slotPanel(slot)}
      panelRef={sizer.keep(slotPanel(slot))}
      defaultSize={sizeOf(layout, arrangement, slot)}
      minSize={minSize}
      groupResizeBehavior="preserve-pixel-size"
      className="flex min-h-0 min-w-0 flex-col"
    >
      <Slotted slot={slot} {...shared} />
    </ResizablePanel>
  );
}

/** The strips in one slot: one fills it, two share it with a border between them. */
function Slotted({ slot, arrangement, layout, sizer, strips }: SlotProps & { slot: Slot }) {
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
      <Border sizeKey={key} group={group} variant="gap" sizer={sizer} />
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
