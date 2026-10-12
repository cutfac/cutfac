import {
  ArrowLeftIcon,
  CircleCheckIcon,
  CircleXIcon,
  ClapperboardIcon,
  FileTextIcon,
  PlusIcon,
  ShieldCheckIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { ErrorAlert, ListSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { cn, safeHttpUrl } from "@/lib/utils";

import {
  api,
  fileUrl,
  onAgentRun,
  STATUSES,
  type AgentChoice,
  type Feedback,
  type ItemDetail,
  type Media,
  type MediaReport,
  type Status,
} from "../api.ts";
import { agentLabel, Chat } from "../components/editor/chat.tsx";
import { aspectRatio, Stage } from "../components/editor/stage.tsx";
import { Timeline } from "../components/editor/timeline.tsx";
import { Transport } from "../components/editor/transport.tsx";
import { href, useLive } from "../hooks.ts";
import { type Locale, useLocale, useMessages } from "../i18n/index.ts";
import { Player } from "../lib/player.ts";
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
const CONTROL = "button, a[href], [role='button'], [role='tab'], [role='option'], [role='slider']";

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const media = item === undefined ? undefined : shownMedia(item, mediaName);
  const video = media?.kind === "video";
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

  /** Show `name` and put the playhead at `at`, waiting for the file to load if it is another. */
  function goTo(name: string | undefined, at: number | undefined) {
    const next = item?.media.find((entry) => entry.name === name);
    const switching = next !== undefined && next.name !== media?.name;

    if (switching) setMediaName(next.name);

    if (at === undefined || (next ?? media)?.kind !== "video") return;

    if (switching) player.seekOnLoad(at);
    else player.seek(at);
  }

  function pick(name: string) {
    if (name === media?.name) return;

    player.pause();
    setMediaName(name);
    clear();
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || within(event.target, TEXT_ENTRY)) return;

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

  const running = item.running || run.status === "running";

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
        <Toolbar item={item} running={running} agent={run.agent} onItem={setData} />
        {media === undefined ? (
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
              onMarked={focusComposer}
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
            <MediaStrip
              item={item}
              shown={media}
              onPick={pick}
              onItem={setData}
              onUploaded={setMediaName}
            />
          </>
        )}
      </section>
      <aside className="flex min-h-0 w-105 shrink-0 flex-col border-l">
        <Tabs defaultValue="chat" className="min-h-0 flex-1">
          <div className="border-b p-2">
            <TabsList className="w-full">
              <TabsTrigger value="chat">{t.item.chat}</TabsTrigger>
              <TabsTrigger value="checks">{t.item.checks}</TabsTrigger>
              <TabsTrigger value="details">{t.item.details}</TabsTrigger>
            </TabsList>
          </div>
          {/* Kept mounted so a half-typed request survives a look at the other tabs. */}
          <TabsContent value="chat" keepMounted className="flex min-h-0 flex-col">
            <Chat
              item={item}
              media={media}
              run={run}
              target={target}
              defaultAgent={defaultAgent}
              inputRef={inputRef}
              onItem={setData}
              onClearTarget={clear}
              onShow={(feedback: Feedback) => {
                const shown = targetOf(feedback);

                goTo(feedback.media, anchorOf(shown));
                setGhost(shown);
              }}
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
              <Checks id={item.id} />
            </div>
          </TabsContent>
          <TabsContent value="details" className="min-h-0 overflow-y-auto">
            <div className="p-4">
              <Details item={item} />
            </div>
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}

function Toolbar({
  item,
  running,
  agent,
  onItem,
}: {
  item: ItemDetail;
  running: boolean;
  agent: LiveRun["agent"];
  onItem: (item: ItemDetail) => void;
}) {
  const t = useMessages();
  const statuses = STATUSES.map((status) => ({ value: status, label: t.status[status] }));

  return (
    <div className="flex min-w-0 items-center gap-2">
      <a href={href("board")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeftIcon data-icon="inline-start" />
        {t.nav.board}
      </a>
      <h1 className="min-w-0 truncate text-base font-semibold">{item.doc.title}</h1>
      {running ? (
        <Badge variant="secondary">
          <Spinner data-icon="inline-start" />
          {t.item.editing(agentLabel(agent) ?? t.chat.agent)}
        </Badge>
      ) : null}
      <Select
        items={statuses}
        value={item.doc.status}
        onValueChange={(status: Status | null) => {
          if (status !== null) api.updateItem(item.id, { status }).then(onItem, showError);
        }}
      >
        <SelectTrigger size="sm" className="ml-auto" aria-label={t.item.status}>
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

/** Upload the first file in a drop or a file picker; the server names it with its aspect. */
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
    fromInput: (event: ChangeEvent<HTMLInputElement>) => {
      upload(event.target.files?.[0]);
      event.target.value = "";
    },
    fromDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      upload(event.dataTransfer.files[0]);
    },
  };
}

const allowDrop = (event: DragEvent<HTMLElement>) => event.preventDefault();

function NoMedia({
  item,
  onItem,
  onUploaded,
}: {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
  onUploaded: (name: string) => void;
}) {
  const { uploading, fromInput, fromDrop } = useUpload(item, onItem, onUploaded);
  const t = useMessages();

  return (
    <div
      className="flex flex-1 rounded-3xl border border-dashed"
      onDragOver={allowDrop}
      onDrop={fromDrop}
    >
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClapperboardIcon />
          </EmptyMedia>
          <EmptyTitle>{t.item.noMediaTitle}</EmptyTitle>
          <EmptyDescription>{t.item.noMediaBody}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <label className={buttonVariants({ variant: "outline" })}>
            {uploading ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            {t.item.addMedia}
            <input type="file" accept="video/*,image/*" className="sr-only" onChange={fromInput} />
          </label>
        </EmptyContent>
      </Empty>
    </div>
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
  const { uploading, fromInput, fromDrop } = useUpload(item, onItem, onUploaded);
  const t = useMessages();

  return (
    <div
      className="flex shrink-0 gap-2 overflow-x-auto pb-1"
      onDragOver={allowDrop}
      onDrop={fromDrop}
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
      <label
        className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-1 text-xs text-muted-foreground select-none hover:bg-muted has-focus-visible:bg-muted"
        title={t.item.addMedia}
      >
        {uploading ? <Spinner /> : <PlusIcon className="size-4" />}
        {t.item.add}
        <input type="file" accept="video/*,image/*" className="sr-only" onChange={fromInput} />
      </label>
    </div>
  );
}

function Thumbnail({ src, media }: { src: string; media: Media }) {
  const frame =
    "aspect-square w-full rounded-md bg-muted object-cover ring-1 ring-foreground/10 group-aria-pressed/media:ring-2 group-aria-pressed/media:ring-selection";

  if (media.kind === "image") return <img src={src} alt="" loading="lazy" className={frame} />;

  // `#t` shows a frame a little in, past a black first frame.
  return <video src={`${src}#t=0.5`} muted preload="metadata" className={frame} />;
}

/** Whether each video will upload: length, shape, size and encoding, from the workspace's rules. */
function Checks({ id }: { id: string }) {
  const [reports, setReports] = useState<ReadonlyArray<MediaReport> | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const t = useMessages();

  function check() {
    setChecking(true);
    api
      .verify(id)
      .then(setReports, showError)
      .finally(() => setChecking(false));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">{t.item.checksBody}</p>
        <Button variant="outline" size="sm" disabled={checking} onClick={check}>
          {checking ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheckIcon data-icon="inline-start" />
          )}
          {reports === undefined ? t.item.runChecks : t.item.runAgain}
        </Button>
      </div>
      {reports?.length === 0 ? <p className="text-muted-foreground">{t.item.noVideos}</p> : null}
      {reports?.map((report) => (
        <div key={report.file} className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 font-medium">
            {report.ok ? (
              <CircleCheckIcon className="size-4 text-primary" />
            ) : (
              <CircleXIcon className="size-4 text-destructive" />
            )}
            {report.file}
          </p>
          <ul className="flex flex-col gap-1 pl-5.5">
            {report.checks.map((item) => (
              <li
                key={item.name}
                className={cn("text-xs", item.ok ? "text-muted-foreground" : "text-destructive")}
              >
                <span className="font-medium">{item.name}</span>: {item.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

const count = (value: number | undefined, locale: Locale) => value?.toLocaleString(locale) ?? "–";

/** The item's plan and record: hook, captions per platform, schedule, numbers, and notes. */
function Details({ item }: { item: ItemDetail }) {
  const { doc } = item;
  const platforms = Object.entries(doc.platforms);
  const docs = Object.entries(item.docs);
  const t = useMessages();
  const locale = useLocale();

  return (
    <div className="flex flex-col gap-6">
      <dl className="flex flex-col gap-3">
        {doc.format === undefined ? null : <Field label={t.item.format}>{doc.format}</Field>}
        {doc.reference === undefined ? null : (
          <Field label={t.item.reference}>
            <a href={href("references", doc.reference)} className="underline underline-offset-4">
              {doc.reference}
            </a>
          </Field>
        )}
        {doc.hook === undefined ? null : <Field label={t.item.hook}>{doc.hook}</Field>}
        {doc.caption === undefined ? null : <Field label={t.item.caption}>{doc.caption}</Field>}
        {doc.notes === undefined ? null : <Field label={t.item.notes}>{doc.notes}</Field>}
      </dl>
      {platforms.map(([platform, copy]) =>
        copy === undefined ? null : (
          <section key={platform} className="flex flex-col gap-1.5">
            <h2 className="font-medium capitalize">{platform}</h2>
            {copy.title === undefined ? null : <p className="font-medium">{copy.title}</p>}
            {copy.caption === undefined ? null : (
              <p className="whitespace-pre-wrap">{copy.caption}</p>
            )}
            {copy.hashtags === undefined || copy.hashtags.length === 0 ? null : (
              <p className="text-muted-foreground">{copy.hashtags.join(" ")}</p>
            )}
            {copy.firstComment === undefined ? null : (
              <p className="whitespace-pre-wrap text-muted-foreground">
                {t.item.firstComment(copy.firstComment)}
              </p>
            )}
          </section>
        ),
      )}
      {doc.schedule.length === 0 ? null : (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-medium">{t.item.schedule}</h2>
          <ul className="flex flex-col gap-1">
            {doc.schedule.map((slot) => {
              const link = slot.url === undefined ? undefined : safeHttpUrl(slot.url);

              return (
                <li key={slot.platform} className="text-muted-foreground">
                  <span className="text-foreground capitalize">{slot.platform}</span> ·{" "}
                  {new Date(slot.at).toLocaleString(locale)} · {t.scheduleStatus(slot.status)}
                  {link === undefined ? null : (
                    <>
                      {" · "}
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-4"
                      >
                        {t.item.open}
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {doc.metrics.length === 0 ? null : (
        <section className="flex flex-col gap-1.5">
          <h2 className="font-medium">{t.item.metrics}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">{t.item.platform}</th>
                  <th className="py-1 font-medium">{t.item.date}</th>
                  <th className="py-1 text-right font-medium">{t.item.views}</th>
                  <th className="py-1 text-right font-medium">{t.item.likes}</th>
                  <th className="py-1 text-right font-medium">{t.item.shares}</th>
                  <th className="py-1 text-right font-medium">{t.item.saves}</th>
                </tr>
              </thead>
              <tbody>
                {doc.metrics.map((row) => (
                  <tr key={`${row.platform}-${row.at}`} className="border-t">
                    <td className="py-1 capitalize">{row.platform}</td>
                    <td className="py-1">{new Date(row.at).toLocaleDateString(locale)}</td>
                    <td className="py-1 text-right">{count(row.views, locale)}</td>
                    <td className="py-1 text-right">{count(row.likes, locale)}</td>
                    <td className="py-1 text-right">{count(row.shares, locale)}</td>
                    <td className="py-1 text-right">{count(row.saves, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {docs.map(([name, text]) =>
        text === undefined ? null : (
          <details key={name} className="group/doc">
            <summary className="-mx-1 flex items-center gap-1.5 rounded-md px-1 font-medium outline-none select-none focus-visible:bg-muted">
              <FileTextIcon className="size-4 text-muted-foreground" />
              {name}
            </summary>
            <div className="typeset typeset-chat mt-2">
              <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
            </div>
          </details>
        ),
      )}
    </div>
  );
}
