import { useEffect, useEffectEvent, useRef, useState } from "react";

import { ErrorAlert, ListSkeleton } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { InTitleBar } from "@/components/title-bar";
import type { DroppedFile } from "@/components/ui/dropzone";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { api, onAgentRun, type AgentChoice, type Feedback } from "../api.ts";
import { ReferenceStrip, useAttachments } from "../components/editor/attachments.tsx";
import { Chat, ChatComposer } from "../components/editor/chat.tsx";
import { Checks } from "../components/editor/checks.tsx";
import { editInput, preferredAgent, sendRequest } from "../components/editor/composer.tsx";
import { Details } from "../components/editor/details.tsx";
import { EditorDock, SectionGrip } from "../components/editor/dock.tsx";
import { HistoryPanel, useItemHistory } from "../components/editor/history.tsx";
import { mediaUrl, MediaStrip, NoMedia, shownMedia } from "../components/editor/item-media.tsx";
import { Toolbar } from "../components/editor/item-toolbar.tsx";
import { RenderFrame, RenderProvider, useItemRender } from "../components/editor/render-card.tsx";
import { ShortcutsDialog } from "../components/editor/shortcuts.tsx";
import { aspectRatio, Stage } from "../components/editor/stage.tsx";
import { Timeline } from "../components/editor/timeline.tsx";
import { Transport } from "../components/editor/transport.tsx";
import { useAgentStatuses, useLive, useModelPicks } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { onEditCommand, type EditCommand } from "../lib/edit-commands.ts";
import { redoable, undoable } from "../lib/history.ts";
import { pickedSettings } from "../lib/models.ts";
import { Player, usePlayer } from "../lib/player.ts";
import { renderedName, shellRender } from "../lib/render.ts";
import { pinsOn } from "../lib/requests.ts";
import { NO_RUN, reduceRun, type LiveRun } from "../lib/run.ts";
import {
  anchorOf,
  isEmptyTarget,
  NO_TARGET,
  roundTime,
  targetOf,
  withEnd,
  withRange,
  withRegion,
  withStart,
  type Target,
} from "../lib/target.ts";

/** Where typing goes to the element, so the editor's single-key shortcuts stay out of the way. */
const TEXT_ENTRY =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='listbox'], [role='menu']";

/** Controls that Space and the arrow keys already operate. */
const CONTROL =
  "button, a[href], [role='button'], [role='tab'], [role='option'], [role='slider'], [role='separator']";

const within = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null;

interface ItemViewProps {
  id: string;
  defaultAgent: AgentChoice | undefined;
}

/**
 * One piece of content, open for editing. Select a part of the video on the timeline or a box
 * on the frame, say what should change, and an agent makes the edit; the chat keeps each
 * request with its result to keep or undo.
 */
export function ItemView({ id, defaultAgent }: ItemViewProps) {
  const { data: item, error, setData } = useLive(`item:${id}`, () => api.item(id));
  const [player] = useState(() => new Player());
  const [mediaName, setMediaName] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState<Target>(NO_TARGET);
  const [ghost, setGhost] = useState<Target | undefined>(undefined);
  const [loop, setLoop] = useState(true);
  const [run, setRun] = useState<LiveRun>(NO_RUN);
  const [shortcuts, setShortcuts] = useState(false);
  const [tab, setTab] = useState<string>("chat");
  const statuses = useAgentStatuses();
  const [chosen, setChosen] = useState<AgentChoice | undefined>(undefined);
  const agent = chosen ?? preferredAgent(defaultAgent, statuses);
  const [picks, setPick] = useModelPicks();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const media = item === undefined ? undefined : shownMedia(item, mediaName);
  const video = media?.kind === "video";
  const videoRatio = usePlayer(player, (state) => state.ratio);
  // The server refuses to step through the history while an agent writes to the item.
  const running = item !== undefined && (item.running || run.status === "running");
  const history = useItemHistory(setData);
  // The files going with the chat's next request, and with the next request about a box.
  const chatFiles = useAttachments(id, setData);
  const boxFiles = useAttachments(id, setData);
  const t = useMessages();

  useEffect(
    () => onAgentRun(id, (message) => setRun((current) => reduceRun(current, message))),
    [id],
  );

  // The player wraps playback inside the selection while the loop is on.
  useEffect(() => {
    const { start, end } = target;

    player.setLoop(loop && start !== undefined && end !== undefined ? { start, end } : undefined);
  }, [player, loop, target]);

  const clear = () => {
    setTarget(NO_TARGET);
    setGhost(undefined);
  };

  const focusComposer = () => inputRef.current?.focus({ preventScroll: true });

  /** Attach files to the next request and put the cursor in the box it is written in. */
  function attachToChat(files: ReadonlyArray<DroppedFile>) {
    chatFiles.add(files);
    focusComposer();
  }

  /** Show `name` and put the playhead at `at`, waiting for the file to load if it is another. */
  function goTo(name: string | undefined, at: number | undefined) {
    const next = item?.media.find((entry) => entry.name === name);
    const switching = next !== undefined && next.name !== media?.name;

    if (switching) setMediaName(next.name);

    if (at === undefined || (next ?? media)?.kind !== "video") return;

    if (switching) player.seekOnLoad(at);
    else player.seek(at);
  }

  // A render that finishes shows what it wrote and plays it from where the request pointed.
  const renderView = useItemRender(id, shellRender(run.steps, run.status === "running"), (done) => {
    const name = item === undefined ? undefined : renderedName(done, item.dir);
    const at = target.start ?? 0;

    if (name === undefined) return;

    // The render's end can reach the board before the file it rewrote does.
    if (name === media?.name && media.mtime >= done.startedAt) {
      player.playFrom(at);
    } else {
      player.pause();
      setMediaName(name);
      player.seekOnLoad(at, true);
    }
  });

  /** Show where a past request pointed: its media, its moment, its outline. */
  function show(feedback: Feedback) {
    const shown = targetOf(feedback);

    goTo(feedback.media, anchorOf(shown));
    setGhost(shown);
  }

  function pick(name: string) {
    if (name === media?.name) return;

    player.pause();
    setMediaName(name);
    clear();
  }

  /** Undo or redo a change to the item, when there is one to take back or make again. */
  function edit(command: EditCommand) {
    if (item === undefined || running) return;

    const entry = command === "undo" ? undoable(item.history) : redoable(item.history);

    if (entry !== undefined) history.step(command, item.id);
  }

  const onEdit = useEffectEvent(edit);

  useEffect(() => onEditCommand((command) => onEdit(command)), []);

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || within(event.target, TEXT_ENTRY)) return;

    // `?` is Shift and a different key on each layout, so it goes by the character.
    if (event.key === "?") {
      event.preventDefault();
      setShortcuts(true);

      return;
    }

    const onControl = within(event.target, CONTROL);
    const now = () => roundTime(player.getState().time);

    switch (event.code) {
      case "Space":
        if (!video || onControl) return;

        player.toggle();
        break;

      case "KeyI":
        if (!video) return;

        setTarget((current) => withStart(current, now()));
        setGhost(undefined);
        break;

      case "KeyO":
        if (!video) return;

        setTarget((current) => withEnd(current, now()));
        setGhost(undefined);
        break;

      case "KeyL":
        if (!video) return;

        setLoop((current) => !current);
        break;

      case "ArrowLeft":
      case "ArrowRight":
        if (!video || onControl) return;

        player.step((event.code === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1));
        break;

      case "Escape":
        if (isEmptyTarget(target) && ghost === undefined) return;

        clear();
        break;

      default:
        return;
    }

    event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);

    addEventListener("keydown", listener);

    return () => removeEventListener("keydown", listener);
  }, []);

  if (error !== undefined && item === undefined) {
    return (
      <div className="flex-1 p-6">
        <ErrorAlert title={t.item.openError} message={error} />
      </div>
    );
  }

  if (item === undefined) {
    return (
      <div className="flex-1 p-6">
        <ListSkeleton rows={4} />
      </div>
    );
  }

  const pins = pinsOn(item, media?.name, run);

  return (
    <>
      <InTitleBar>
        <Toolbar
          item={item}
          running={running}
          agent={run.agent}
          asking={
            run.approvals.length === 0
              ? undefined
              : run.approvals.some((approval) => approval.kind !== "question")
                ? "approval"
                : "question"
          }
          onItem={setData}
          onEdit={edit}
          onShortcuts={() => setShortcuts(true)}
        />
      </InTitleBar>
      <EditorDock
        stage={
          media === undefined ? (
            <NoMedia item={item} onItem={setData} onUploaded={setMediaName} />
          ) : (
            <>
              <RenderFrame
                view={renderView}
                ratio={(video ? videoRatio : undefined) ?? aspectRatio(media.aspect) ?? 9 / 16}
                previous={
                  renderView.render?.status === "running" &&
                  renderedName(renderView.render, item.dir) === media.name
                }
              >
                <Stage
                  player={player}
                  src={mediaUrl(item, media)}
                  kind={media.kind}
                  ratio={aspectRatio(media.aspect)}
                  region={target.region}
                  ghost={ghost?.region}
                  onRegion={(region) => {
                    setTarget((current) => withRegion(current, region));
                    setGhost(undefined);
                  }}
                  ask={{
                    item,
                    agent,
                    files: boxFiles,
                    onSend: (body, versions, attachments) =>
                      sendRequest(
                        item,
                        editInput(
                          body,
                          agent,
                          pickedSettings(statuses, picks, agent),
                          media,
                          target,
                          versions,
                          attachments,
                        ),
                        setData,
                        setRun,
                      ).then((sentTo) => {
                        setTab("chat");

                        // `/feedback` leaves the box drawn, so the request about it can still follow.
                        if (sentTo === "item") clear();

                        return sentTo;
                      }),
                  }}
                  onAttach={attachToChat}
                  pins={pins}
                  onPin={(feedback) => {
                    show(feedback);
                    setTab("chat");
                  }}
                />
              </RenderFrame>
              {video ? (
                <>
                  <Timeline
                    player={player}
                    src={mediaUrl(item, media)}
                    target={target}
                    ghost={ghost}
                    onRange={(from, to) => {
                      setTarget((current) => withRange(current, from, to));
                      setGhost(undefined);
                    }}
                    onMarked={focusComposer}
                    pins={pins}
                  />
                  <Transport
                    player={player}
                    target={target}
                    loop={loop}
                    onLoop={setLoop}
                    onIn={() =>
                      setTarget((current) => withStart(current, roundTime(player.getState().time)))
                    }
                    onOut={() =>
                      setTarget((current) => withEnd(current, roundTime(player.getState().time)))
                    }
                  />
                </>
              ) : (
                <p className="text-center text-xs text-muted-foreground">{t.item.imageHint}</p>
              )}
            </>
          )
        }
        strips={
          media === undefined
            ? undefined
            : {
                media: (
                  <MediaStrip
                    item={item}
                    shown={media}
                    onPick={pick}
                    onItem={setData}
                    onUploaded={setMediaName}
                  />
                ),
                references: (
                  <ReferenceStrip
                    item={item}
                    onItem={setData}
                    onAttach={(path) => {
                      chatFiles.attach(path);
                      focusComposer();
                    }}
                    onDetach={(path) => {
                      const holding = [chatFiles, boxFiles].filter((files) =>
                        files.paths.includes(path),
                      );

                      for (const files of holding) files.detach(path);

                      return () => {
                        for (const files of holding) files.attach(path);
                      };
                    }}
                  />
                ),
              }
        }
        chat={
          <aside className="flex min-h-0 flex-1 flex-col">
            <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
              <div className="flex items-center gap-1 border-b p-2">
                <TabsList className="min-w-0 flex-1">
                  <TabsTrigger value="chat">{t.item.chat}</TabsTrigger>
                  <TabsTrigger value="checks">{t.item.checks}</TabsTrigger>
                  <TabsTrigger value="history">{t.item.history}</TabsTrigger>
                  <TabsTrigger value="details">{t.item.details}</TabsTrigger>
                </TabsList>
                <SectionGrip section="chat" />
              </div>
              {/* Kept mounted so the chat keeps its scroll and a half-written answer across tabs. */}
              <TabsContent value="chat" keepMounted className="flex min-h-0 flex-col">
                <RenderProvider value={renderView}>
                  <Chat
                    item={item}
                    media={media}
                    run={run}
                    statuses={statuses}
                    agent={agent}
                    picks={picks}
                    inputRef={inputRef}
                    onItem={setData}
                    onRun={setRun}
                    onShow={show}
                    onRetarget={(feedback: Feedback) => {
                      const again = targetOf(feedback);

                      goTo(feedback.media, anchorOf(again));
                      setTarget(again);
                      setGhost(undefined);
                    }}
                    onCompare={() => player.pause()}
                  />
                </RenderProvider>
              </TabsContent>
              <TabsContent value="checks" className="min-h-0 overflow-y-auto">
                <SelectionArea className="p-4">
                  <Checks item={item} />
                </SelectionArea>
              </TabsContent>
              <TabsContent value="history" className="min-h-0 overflow-y-auto">
                <div className="p-4">
                  <HistoryPanel
                    item={item}
                    running={running}
                    onGoTo={(entryId) => history.goTo(item.id, entryId)}
                    onRestore={(version) => history.restore(item.id, version)}
                    onPreview={() => player.pause()}
                  />
                </div>
              </TabsContent>
              <TabsContent value="details" className="min-h-0 overflow-y-auto">
                <SelectionArea className="p-4">
                  <Details item={item} onItem={setData} />
                </SelectionArea>
              </TabsContent>
            </Tabs>
            <ChatComposer
              item={item}
              media={media}
              target={target}
              statuses={statuses}
              agent={agent}
              onAgent={setChosen}
              picks={picks}
              onPick={setPick}
              run={run}
              inputRef={inputRef}
              files={chatFiles}
              onItem={setData}
              onRun={setRun}
              onClearTarget={clear}
              onSent={() => setTab("chat")}
            />
          </aside>
        }
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </>
  );
}
