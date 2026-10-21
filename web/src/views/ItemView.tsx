import {
  ArrowLeftIcon,
  ClapperboardIcon,
  KeyboardIcon,
  PlusIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert, ListSkeleton } from "@/components/page";
import { InTitleBar } from "@/components/title-bar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dropzone, type DroppedFile } from "@/components/ui/dropzone";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  api,
  fileUrl,
  onAgentRun,
  STATUSES,
  type AgentChoice,
  type Feedback,
  type ItemDetail,
  type Media,
  type Status,
} from "../api.ts";
import { FileStrip, ReferenceStrip, useAttachments } from "../components/editor/attachments.tsx";
import { agentLabel, Chat } from "../components/editor/chat.tsx";
import { Checks } from "../components/editor/checks.tsx";
import { editInput, preferredAgent, sendRequest } from "../components/editor/composer.tsx";
import { Details } from "../components/editor/details.tsx";
import { EditorDock, SectionGrip } from "../components/editor/dock.tsx";
import { Hint, keepFocus } from "../components/editor/hint.tsx";
import { HistoryPanel, useItemHistory } from "../components/editor/history.tsx";
import { ShortcutsDialog } from "../components/editor/shortcuts.tsx";
import { aspectRatio, Stage } from "../components/editor/stage.tsx";
import { Timeline } from "../components/editor/timeline.tsx";
import { Transport } from "../components/editor/transport.tsx";
import { href, useAgentStatuses, useLive, useModelPicks } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { EDIT_KEYS, onEditCommand, type EditCommand } from "../lib/edit-commands.ts";
import { redoable, undoable } from "../lib/history.ts";
import { pickedSettings } from "../lib/models.ts";
import { Player } from "../lib/player.ts";
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

const showError = (cause: Error) => {
  toast.error(cause.message);
};

/** Where typing goes to the element, so the editor's single-key shortcuts stay out of the way. */
const TEXT_ENTRY =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='listbox'], [role='menu']";

/** Controls that Space and the arrow keys already operate. */
const CONTROL =
  "button, a[href], [role='button'], [role='tab'], [role='option'], [role='slider'], [role='separator']";

const within = (target: EventTarget | null, selector: string) =>
  target instanceof Element && target.closest(selector) !== null;

/** The media to show: the chosen one, else the first video, else whatever there is. */
function shownMedia(item: ItemDetail, name: string | undefined): Media | undefined {
  return (
    item.media.find((media) => media.name === name) ??
    item.media.find((media) => media.kind === "video") ??
    item.media[0]
  );
}

const mediaUrl = (item: ItemDetail, media: Media) =>
  fileUrl(`${item.dir}/${media.name}`, media.mtime);

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

  /** Show the chat with the cursor in its box, once files are attached to its next request. */
  function toChat() {
    setTab("chat");
    // The chat's tab is hidden until the switch renders.
    requestAnimationFrame(focusComposer);
  }

  function attachToChat(files: ReadonlyArray<DroppedFile>) {
    chatFiles.add(files);
    toChat();
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
                    onClear={clear}
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
                      toChat();
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
              {/* Kept mounted so a half-typed request survives a look at the other tabs. */}
              <TabsContent value="chat" keepMounted className="flex min-h-0 flex-col">
                <Chat
                  item={item}
                  media={media}
                  run={run}
                  target={target}
                  statuses={statuses}
                  agent={agent}
                  onAgent={setChosen}
                  picks={picks}
                  onPick={setPick}
                  inputRef={inputRef}
                  files={chatFiles}
                  onItem={setData}
                  onRun={setRun}
                  onClearTarget={clear}
                  onShow={show}
                  onRetarget={(feedback: Feedback) => {
                    const again = targetOf(feedback);

                    goTo(feedback.media, anchorOf(again));
                    setTarget(again);
                    setGhost(undefined);
                  }}
                  onCompare={() => player.pause()}
                />
              </TabsContent>
              <TabsContent value="checks" className="min-h-0 overflow-y-auto">
                <div className="p-4">
                  <Checks item={item} />
                </div>
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
                <div className="p-4">
                  <Details item={item} onItem={setData} />
                </div>
              </TabsContent>
            </Tabs>
          </aside>
        }
      />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
    </>
  );
}

function Toolbar({
  item,
  running,
  agent,
  onItem,
  onEdit,
  onShortcuts,
}: {
  item: ItemDetail;
  running: boolean;
  agent: LiveRun["agent"];
  onItem: (item: ItemDetail) => void;
  onEdit: (command: EditCommand) => void;
  onShortcuts: () => void;
}) {
  const t = useMessages();
  const statuses = STATUSES.map((status) => ({ value: status, label: t.status[status] }));

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <a href={href("board")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeftIcon data-icon="inline-start" />
        {t.nav.board}
      </a>
      <h1 className="min-w-0 truncate text-sm font-semibold">{item.doc.title}</h1>
      {running ? (
        <Badge variant="secondary">
          <Spinner data-icon="inline-start" />
          {t.item.editing(agentLabel(agent) ?? t.chat.agent)}
        </Badge>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Hint label={t.history.undo} keys={EDIT_KEYS.undo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.history.undo}
            disabled={running || undoable(item.history) === undefined}
            onMouseDown={keepFocus}
            onClick={() => onEdit("undo")}
          >
            <Undo2Icon />
          </Button>
        </Hint>
        <Hint label={t.history.redo} keys={EDIT_KEYS.redo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.history.redo}
            disabled={running || redoable(item.history) === undefined}
            onMouseDown={keepFocus}
            onClick={() => onEdit("redo")}
          >
            <Redo2Icon />
          </Button>
        </Hint>
        <Hint label={t.shortcuts.open} keys="?">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.shortcuts.open}
            onMouseDown={keepFocus}
            onClick={onShortcuts}
          >
            <KeyboardIcon />
          </Button>
        </Hint>
      </div>
      <Select
        items={statuses}
        value={item.doc.status}
        onValueChange={(status: Status | null) => {
          if (status !== null) api.updateItem(item.id, { status }).then(onItem, showError);
        }}
      >
        <SelectTrigger size="sm" aria-label={t.item.status}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {statuses.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Upload a file as new media of the item; the server names it with its aspect. */
function useUpload(
  item: ItemDetail,
  onItem: (item: ItemDetail) => void,
  onUploaded: (name: string) => void,
) {
  const [uploading, setUploading] = useState(false);

  function upload(file: File | undefined) {
    if (file === undefined || uploading) return;

    setUploading(true);

    api
      .uploadMedia(item.id, file)
      .then((next) => {
        onItem(next);

        const added = next.media.find(
          (media) => !item.media.some((old) => old.name === media.name),
        );

        if (added !== undefined) onUploaded(added.name);
      }, showError)
      .finally(() => setUploading(false));
  }

  return {
    uploading,
    /** Takes the first of the files dropped or picked. */
    fromFiles: (files: ReadonlyArray<DroppedFile>) => upload(files[0]?.file),
  };
}

const MEDIA_ACCEPT = "video/*,image/*";

function NoMedia({
  item,
  onItem,
  onUploaded,
}: {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
  onUploaded: (name: string) => void;
}) {
  const { uploading, fromFiles } = useUpload(item, onItem, onUploaded);
  const openFiles = useRef<() => void>(null);
  const t = useMessages();

  return (
    <Dropzone
      label={t.attachments.drop.media}
      accept={MEDIA_ACCEPT}
      multiple={false}
      openRef={openFiles}
      onFiles={fromFiles}
      className="flex flex-1"
    >
      <div className="flex flex-1 rounded-3xl border border-dashed">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClapperboardIcon />
            </EmptyMedia>
            <EmptyTitle>{t.item.noMediaTitle}</EmptyTitle>
            <EmptyDescription>{t.item.noMediaBody}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => openFiles.current?.()}>
              {uploading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {t.item.addMedia}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </Dropzone>
  );
}

/** Every file of the item; pick one to edit, or add another. */
function MediaStrip({
  item,
  shown,
  onPick,
  onItem,
  onUploaded,
}: {
  item: ItemDetail;
  shown: Media;
  onPick: (name: string) => void;
  onItem: (item: ItemDetail) => void;
  onUploaded: (name: string) => void;
}) {
  const { uploading, fromFiles } = useUpload(item, onItem, onUploaded);
  const t = useMessages();

  return (
    <FileStrip
      title={t.attachments.media}
      label={t.attachments.drop.media}
      addLabel={t.item.addMedia}
      accept={MEDIA_ACCEPT}
      multiple={false}
      uploading={uploading}
      onFiles={fromFiles}
    >
      {item.media.map((media) => (
        <button
          key={media.name}
          type="button"
          aria-pressed={media.name === shown.name}
          title={media.name}
          className="group/media flex w-20 shrink-0 flex-col gap-1 rounded-lg p-1 text-left outline-none select-none hover:bg-muted focus-visible:bg-muted"
          onClick={() => onPick(media.name)}
        >
          <Thumbnail src={mediaUrl(item, media)} media={media} />
          <span className="truncate text-xs text-muted-foreground group-aria-pressed/media:font-medium group-aria-pressed/media:text-foreground">
            {media.name}
          </span>
        </button>
      ))}
    </FileStrip>
  );
}

function Thumbnail({ src, media }: { src: string; media: Media }) {
  const frame =
    "aspect-square w-full rounded-md bg-muted object-cover ring-1 ring-foreground/10 group-aria-pressed/media:ring-2 group-aria-pressed/media:ring-selection";

  if (media.kind === "image") return <img src={src} alt="" loading="lazy" className={frame} />;

  // `#t` shows a frame a little in, past a black first frame.
  return <video src={`${src}#t=0.5`} muted preload="metadata" className={frame} />;
}
