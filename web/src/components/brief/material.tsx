import { Option } from "effect";
import {
  AppWindowIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  FileIcon,
  FilmIcon,
  FolderIcon,
  GlobeIcon,
  SparklesIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { MaterialCard } from "@/components/brief/material-add";
import { useFirstReading } from "@/components/first-ideas";
import { ErrorAlert, ListSkeleton, Section } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { safeHttpUrl } from "@/lib/utils";

import { api, fileUrl, type Learned, type LearnedKind, type LearnedList } from "../../api.ts";
import { useAgentStatuses, useLive, type Live } from "../../hooks.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { importAgent } from "../../lib/imports.ts";
import { LiveState } from "../../lib/live.ts";
import { errorText } from "../../lib/notify.ts";

const KIND_ICONS: Record<LearnedKind, LucideIcon> = {
  page: GlobeIcon,
  app: AppWindowIcon,
  video: FilmIcon,
  folder: FolderIcon,
  file: FileIcon,
};

/**
 * What the agent read: add a source, see each one with what the agent kept from it, and have the
 * agent read the new ones now rather than before the next video.
 */
export function MaterialSection({
  learned,
  kept,
}: {
  learned: Live<LearnedList>;
  /** What the agent wrote in about.md for each source, by its id. */
  kept: ReadonlyMap<string, string>;
}) {
  const t = useMessages();
  const { reading, reload } = useFirstReading();
  const { state, data, setData } = learned;
  const unread = data?.learned.filter((entry) => entry.unread).length ?? 0;

  return (
    <Section
      title={t.learn.materials}
      description={t.learn.materialsBody}
      body="open"
      action={<ReadNow unread={unread} reading={reading} onStarted={reload} />}
    >
      <MaterialCard onLearned={learned.reload}>
        {LiveState.$is("Failed")(state) ? (
          <div className="px-3 pb-3">
            <ErrorAlert title={t.learn.loadError} message={state.error} />
          </div>
        ) : data === undefined ? (
          <div className="px-3 pb-3">
            <ListSkeleton rows={2} />
          </div>
        ) : data.learned.length === 0 ? (
          <p className="border-t px-4 py-4 text-sm text-muted-foreground">{t.learn.emptyBody}</p>
        ) : (
          <ul>
            {data.learned.map((entry) => (
              <SourceRow
                key={entry.id}
                entry={entry}
                kept={kept.get(entry.id) ?? ""}
                reading={reading}
                onForgot={setData}
              />
            ))}
          </ul>
        )}
      </MaterialCard>
    </Section>
  );
}

/** Starts the agent on the sources it hasn't read; while it reads, says so. */
function ReadNow({
  unread,
  reading,
  onStarted,
}: {
  unread: number;
  reading: boolean;
  onStarted: () => void;
}) {
  const t = useMessages();
  const locale = useLocale();
  const statuses = useAgentStatuses();
  const { data: ws } = useLive("workspace", api.workspace);
  const [starting, setStarting] = useState(false);
  const agent = importAgent(ws?.config.agent.default, statuses);

  if (reading)
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        {t.learn.agentReading}
      </span>
    );

  if (unread === 0) return null;

  function start() {
    if (Option.isNone(agent)) return;
    setStarting(true);
    api
      .startImport({ kind: "learn", agent: agent.value, locale })
      .then(onStarted)
      .catch((cause) => toast.error(`${t.learn.readFailed}: ${errorText(cause)}`))
      .finally(() => setStarting(false));
  }

  return (
    <Button
      size="sm"
      disabled={starting || Option.isNone(agent)}
      title={Option.isNone(agent) ? t.learn.noAgent : t.learn.readNowHint(unread)}
      onClick={start}
    >
      {starting ? <Spinner data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
      {t.learn.readNow}
    </Button>
  );
}

/** A source in a line, opening onto what the agent kept from it. */
function SourceRow({
  entry,
  kept,
  reading,
  onForgot,
}: {
  entry: Learned;
  kept: string;
  reading: boolean;
  onForgot: (rest: LearnedList) => void;
}) {
  const t = useMessages();
  const { doc, dir } = entry;
  const image = doc.images[0];

  return (
    <Collapsible render={<RowItem />}>
      <div className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/4 has-focus-visible:bg-foreground/4">
        <CollapsibleTrigger render={<RowButton />}>
          <SourceThumb entry={entry} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{doc.title}</span>
            <span className="truncate text-xs text-muted-foreground">
              {t.learn.kinds[doc.kind]} · <SourceText entry={entry} />
            </span>
          </span>
          {entry.unread ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              {reading ? (
                <Spinner className="size-3" />
              ) : (
                <span className="size-1.5 rounded-full bg-brand" />
              )}
              {reading ? t.learn.readingOne : t.learn.unread}
            </span>
          ) : null}
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-data-panel-open/trigger:rotate-90" />
        </CollapsibleTrigger>
        <ForgetButton entry={entry} onForgot={onForgot} />
      </div>
      <CollapsibleContent>
        <SelectionArea className="flex flex-col gap-3 pr-4 pb-4 pl-16">
          <SourceLink entry={entry} />
          {doc.video ? (
            // Saved clips come without caption tracks.
            // oxlint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={fileUrl(`${dir}/${doc.video}`)}
              poster={image ? fileUrl(`${dir}/${image}`) : undefined}
              preload="metadata"
              className="max-h-72 w-full rounded-xl bg-muted object-contain"
              controls
              playsInline
            />
          ) : null}
          {entry.unread ? (
            <p className="text-sm text-muted-foreground">
              {reading ? t.learn.readingBody : t.learn.unreadBody}
            </p>
          ) : kept === "" ? (
            <p className="text-sm text-muted-foreground">{t.learn.nothingKept}</p>
          ) : (
            <div className="typeset typeset-docs text-sm">
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                {kept}
              </Markdown>
            </div>
          )}
        </SelectionArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RowItem(props: ComponentProps<"li">) {
  return <li className="group/row border-t" {...props} />;
}

/** The whole line opens the row; the line around it tints on hover, as the board's rows do. */
function RowButton(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="group/trigger flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-4 text-left outline-none"
      {...props}
    />
  );
}

function SourceThumb({ entry }: { entry: Learned }) {
  const { doc, dir } = entry;
  const picture = doc.icon ?? doc.images[0];
  const Icon = KIND_ICONS[doc.kind];

  if (picture !== undefined)
    return (
      <img
        src={fileUrl(`${dir}/${picture}`)}
        alt=""
        loading="lazy"
        className="size-9 shrink-0 rounded-lg bg-muted object-cover ring-1 ring-foreground/5"
      />
    );

  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}

/** Where a source came from, short: a link without its scheme, a path, or an upload. */
function SourceText({ entry }: { entry: Learned }) {
  const t = useMessages();
  const source = entry.doc.source;

  if (source === undefined) return <>{t.learn.uploaded}</>;

  if ("path" in source) return <span className="font-mono">{source.path}</span>;

  const url = Option.getOrElse(safeHttpUrl(source.url), () => source.url);

  return <>{url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</>;
}

/** The source as a link to open, under a row that's open; nothing for a path or an upload. */
function SourceLink({ entry }: { entry: Learned }) {
  const t = useMessages();
  const source = entry.doc.source;
  const url = source !== undefined && "url" in source ? safeHttpUrl(source.url) : Option.none();

  if (Option.isNone(url)) return null;

  return (
    <a
      href={url.value}
      target="_blank"
      rel="noreferrer noopener"
      className="flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {t.learn.open}
      <ArrowUpRightIcon className="size-3" />
    </a>
  );
}

function ForgetButton({
  entry,
  onForgot,
}: {
  entry: Learned;
  onForgot: (rest: LearnedList) => void;
}) {
  const [busy, setBusy] = useState(false);
  const t = useMessages();

  function forget() {
    setBusy(true);
    api
      .forgetLearned(entry.id)
      .then((rest) => {
        toast.success(t.learn.forgotten(entry.doc.title));
        onForgot(rest);
      })
      .catch((cause) => toast.error(`${t.learn.forgetError}: ${errorText(cause)}`))
      .finally(() => setBusy(false));
  }

  return (
    <Popover>
      {/* Out of the way until the row is pointed at, as a list's row actions are. */}
      <span className="opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100">
        <PopoverTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={t.learn.forget} />}
        >
          <Trash2Icon />
        </PopoverTrigger>
      </span>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{t.learn.forgetTitle(entry.doc.title)}</PopoverTitle>
          <PopoverDescription>{t.learn.forgetBody}</PopoverDescription>
        </PopoverHeader>
        <Button variant="destructive" size="sm" disabled={busy} onClick={forget}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {t.learn.forget}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
