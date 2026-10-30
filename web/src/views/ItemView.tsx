import { Match, Option } from "effect";
import { useEffect, useRef, useState } from "react";

import { ErrorAlert, ListSkeleton } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { InTitleBar } from "@/components/title-bar";
import type { DroppedFile } from "@/components/ui/dropzone";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { api, onAgentRun, type AgentChoice, type Feedback } from "../api.ts";
import { ReplyTimesProvider, type ReplyTimes } from "../components/editor/agent-question.tsx";
import {
  detachEverywhere,
  ReferenceStrip,
  useAttachments,
} from "../components/editor/attachments.tsx";
import { Chat, ChatComposer } from "../components/editor/chat.tsx";
import { editInput, preferredAgent, sendRequest } from "../components/editor/composer.tsx";
import { Details } from "../components/editor/details.tsx";
import { SectionGrip } from "../components/editor/dock-grip.tsx";
import { EditorDock } from "../components/editor/dock.tsx";
import { PreviewBar } from "../components/editor/history-preview.tsx";
import {
  useItemHistory,
  useVersionPreview,
  VersionHistory,
} from "../components/editor/history.tsx";
import { MediaStrip, NoMedia, shownMedia } from "../components/editor/item-media.tsx";
import { Toolbar } from "../components/editor/item-toolbar.tsx";
import { RenderFrame, RenderProvider, useItemRender } from "../components/editor/render-card.tsx";
import { SampleGuideCard, useSampleGuide } from "../components/editor/sample-guide.tsx";
import { ShortcutsDialog } from "../components/editor/shortcuts.tsx";
import { aspectRatio, Stage } from "../components/editor/stage.tsx";
import { Timeline } from "../components/editor/timeline.tsx";
import { Transport } from "../components/editor/transport.tsx";
import { useAgentStatuses, useLive, useModelPicks } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { useEditCommands, type EditCommand } from "../lib/edit-commands.ts";
import { goTime, useEditorKeys } from "../lib/editor-keys.ts";
import { useFrameRate } from "../lib/frame-rate.ts";
import { redoable, undoable } from "../lib/history.ts";
import { LiveState } from "../lib/live.ts";
import { agentTitle, pickedSettings } from "../lib/models.ts";
import { Player, usePlayer } from "../lib/player.ts";
import { renderedName, shellRender } from "../lib/render.ts";
import { pinsOn } from "../lib/requests.ts";
import { askingOf, NO_RUN, reduceRun, type LiveRun } from "../lib/run.ts";
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
  const { state: load, data: item, setData } = useLive(`item:${id}`, () => api.item(id));
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
  const versionView = useVersionPreview(item, player, setMediaName);
  const { preview } = versionView;
  const media = item === undefined ? undefined : shownMedia(item, preview?.media ?? mediaName);
  const video = media?.kind === "video";
  const fps = useFrameRate(id, media);
  const videoRatio = usePlayer(player, (state) => state.ratio);
  const duration = usePlayer(player, (state) => state.duration);
  // The server refuses to step through the history while an agent writes to the item.
  const running = item !== undefined && (item.running || run.status === "running");
  const history = useItemHistory(setData);
  // The files going with the chat's next request, and with the next request about a box.
  const chatFiles = useAttachments(id, setData);
  const boxFiles = useAttachments(id, setData);
  const guide = useSampleGuide(id, player, target.region);
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

  /** Change what the next request points at, which stops showing a past one's outline. */
  const point = (change: (current: Target) => Target) => {
    setTarget(change);
    setGhost(undefined);
  };

  const clear = () => point(() => NO_TARGET);

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

  /** Point the next request at `next` and show where it starts. */
  function retarget(next: Target, name?: string) {
    goTo(name, anchorOf(next));
    point(() => next);
  }

  const replyTimes: ReplyTimes | undefined = video
    ? {
        duration,
        onPick: (from, to) => {
          retarget(withRange(NO_TARGET, from, to));
          focusComposer();
        },
      }
    : undefined;

  // A render that finishes shows what it wrote and plays it from where the request pointed.
  const renderView = useItemRender(id, shellRender(run.steps, run.status === "running"), (done) => {
    const written = Option.flatMap(Option.fromUndefinedOr(item), ({ dir }) =>
      renderedName(done, dir),
    );

    const at = target.start ?? 0;

    if (Option.isNone(written)) return;

    const name = written.value;

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

    if (Option.isSome(entry)) history.step(command, item.id);
  }

  useEditCommands(edit);

  useEditorKeys((key) => {
    const now = () => roundTime(player.getState().time);

    const onVideo = (action: () => void) => {
      if (!video) return false;

      action();

      return true;
    };

    return Match.valueTags(key, {
      Shortcuts: () => {
        setShortcuts(true);

        return true;
      },
      PlayPause: () => onVideo(() => player.toggle()),
      Mute: () => onVideo(() => player.toggleMute()),
      MarkIn: () => onVideo(() => point((current) => withStart(current, now()))),
      MarkOut: () => onVideo(() => point((current) => withEnd(current, now()))),
      Loop: () => onVideo(() => setLoop((current) => !current)),
      Step: ({ frames }) => onVideo(() => player.step(frames / fps)),
      Go: ({ to }) =>
        Option.match(goTime(to, player.getState().duration, target), {
          onNone: () => false,
          onSome: (at) => onVideo(() => player.seek(at)),
        }),
      Clear: () => {
        if (preview !== undefined) {
          versionView.show(undefined);

          return true;
        }

        if (isEmptyTarget(target) && ghost === undefined) return false;

        clear();

        return true;
      },
    });
  });

  if (LiveState.$is("Failed")(load) && item === undefined) {
    return (
      <div className="flex-1 p-6">
        <ErrorAlert title={t.item.openError} message={load.error} />
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

  const pins = preview === undefined ? pinsOn(item, media?.name, run) : [];

  return (
    <>
      <InTitleBar>
        <Toolbar
          item={item}
          media={media === undefined ? undefined : `${item.dir}/${media.name}`}
          running={running}
          agent={run.agent}
          asking={askingOf(run)}
          versions={versionView.open}
          onItem={setData}
          onEdit={edit}
          onVersions={versionView.toggle}
          onShortcuts={() => setShortcuts(true)}
        />
      </InTitleBar>
      <EditorDock
        stage={
          media === undefined ? (
            <NoMedia
              item={item}
              maker={
                running
                  ? Option.some(agentTitle(Option.fromUndefinedOr(run.agent), t))
                  : Option.none()
              }
              onItem={setData}
              onUploaded={setMediaName}
            />
          ) : (
            <>
              {preview === undefined ? (
                <SampleGuideCard guide={guide} />
              ) : (
                <PreviewBar
                  item={item}
                  version={preview}
                  running={running}
                  onRestore={() =>
                    history.restore(item.id, preview).then(() => versionView.show(undefined))
                  }
                  onClose={() => versionView.show(undefined)}
                />
              )}
              <RenderFrame
                view={renderView}
                ratio={(video ? videoRatio : undefined) ?? aspectRatio(media.aspect) ?? 9 / 16}
                previous={
                  renderView.render?.status === "running" &&
                  Option.contains(renderedName(renderView.render, item.dir), media.name)
                }
              >
                <Stage
                  player={player}
                  src={versionView.src(item, media)}
                  kind={media.kind}
                  ratio={aspectRatio(media.aspect)}
                  region={preview === undefined ? target.region : undefined}
                  ghost={preview === undefined ? ghost?.region : undefined}
                  onRegion={(region) => point((current) => withRegion(current, region))}
                  ask={{
                    item,
                    agent,
                    files: boxFiles,
                    suggestion: guide.suggestion,
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
                        versionView.close();

                        // `/feedback` leaves the box drawn, so the request about it can still follow.
                        if (sentTo === "item") {
                          clear();
                          guide.sent(versions);
                        }

                        return sentTo;
                      }),
                  }}
                  onAttach={attachToChat}
                  pins={pins}
                  onPin={(feedback) => {
                    show(feedback);
                    setTab("chat");
                  }}
                  drawable={preview === undefined}
                />
              </RenderFrame>
              {video ? (
                <>
                  <Timeline
                    player={player}
                    src={versionView.src(item, media)}
                    target={target}
                    ghost={ghost}
                    onRange={(from, to) => point((current) => withRange(current, from, to))}
                    onMarked={focusComposer}
                    pins={pins}
                  />
                  <Transport player={player} target={target} loop={loop} onLoop={setLoop} />
                </>
              ) : (
                <p className="text-center text-xs text-muted-foreground">{t.item.imageHint}</p>
              )}
            </>
          )
        }
        // A strip shows once it holds something to choose from: a second file, or a file kept for agents.
        strips={
          media === undefined
            ? {}
            : {
                media:
                  item.media.length < 2 ? undefined : (
                    <MediaStrip
                      item={item}
                      shown={media}
                      onPick={pick}
                      onItem={setData}
                      onUploaded={setMediaName}
                    />
                  ),
                references:
                  item.references.length === 0 ? undefined : (
                    <ReferenceStrip
                      item={item}
                      onItem={setData}
                      onAttach={(path) => {
                        chatFiles.attach(path);
                        focusComposer();
                      }}
                      onDetach={(path) => detachEverywhere([chatFiles, boxFiles], path)}
                    />
                  ),
              }
        }
        chat={
          <aside className="flex min-h-0 flex-1 flex-col">
            {/* Kept mounted under the version history, so the chat keeps its scroll and drafts. */}
            <div className={cn("flex min-h-0 flex-1 flex-col", versionView.open && "hidden")}>
              <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
                <div className="flex items-center gap-1 p-2">
                  <TabsList className="min-w-0 flex-1">
                    <TabsTrigger value="chat">{t.item.chat}</TabsTrigger>
                    <TabsTrigger value="details">{t.item.details}</TabsTrigger>
                  </TabsList>
                  {versionView.open ? null : <SectionGrip section="chat" />}
                </div>
                {/* Kept mounted so the chat keeps its scroll and a half-written answer across tabs. */}
                <TabsContent value="chat" keepMounted className="flex min-h-0 flex-col">
                  <RenderProvider value={renderView}>
                    <ReplyTimesProvider value={replyTimes}>
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
                        onRetarget={(feedback: Feedback) =>
                          retarget(targetOf(feedback), feedback.media)
                        }
                        onCompare={() => player.pause()}
                        onApplied={(feedback: Feedback) => {
                          goTo(feedback.media, undefined);
                          player.seekOnLoad(anchorOf(targetOf(feedback)) ?? 0, true);
                        }}
                      />
                    </ReplyTimesProvider>
                  </RenderProvider>
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
            </div>
            {versionView.open ? (
              <VersionHistory
                item={item}
                running={running}
                previewing={preview?.id}
                onPreview={versionView.show}
                onClose={versionView.close}
                grip={<SectionGrip section="chat" />}
              />
            ) : null}
          </aside>
        }
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </>
  );
}
