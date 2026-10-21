import {
  FolderOpenIcon,
  GraduationCapIcon,
  LinkIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { useState, type DragEvent, type SubmitEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { ErrorAlert, ListSkeleton, Page } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
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

import { api, fileUrl, type Learned, type LearnedList, type LearnResult } from "../api.ts";
import { desktop } from "../desktop.ts";
import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

/** Learn from a link or path, a dropped or chosen file, or (in the desktop app) a picked folder. */
function AddSource({ onLearned }: { onLearned: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [warnings, setWarnings] = useState<ReadonlyArray<string>>([]);
  const [dragging, setDragging] = useState(false);
  const t = useMessages();
  const pickPath = desktop?.pickPath;

  function learn(run: () => Promise<LearnResult>, label: string, done?: () => void) {
    setBusy(t.learn.reading(label));
    setError(undefined);
    setWarnings([]);
    run()
      .then((result) => {
        done?.();
        setWarnings(result.warnings);
        toast.success(t.learn.learned(result.learned.doc.title));
        onLearned();
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(undefined));
  }

  function learnFile(file: File | undefined) {
    if (file) learn(() => api.learnFile(file), file.name);
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const source = text.trim();

    if (source)
      learn(
        () => api.learn(source),
        source,
        () => setText(""),
      );
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    learnFile(event.dataTransfer.files[0]);
  }

  function onDragLeave(event: DragEvent) {
    const into = event.relatedTarget;

    if (!(into instanceof Node && event.currentTarget.contains(into))) setDragging(false);
  }

  return (
    <div
      className={`flex flex-col gap-3 rounded-3xl border p-4 transition-colors ${dragging ? "border-ring bg-muted/50" : ""}`}
      data-drop-target=""
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <form onSubmit={onSubmit}>
        <InputGroup>
          <InputGroupAddon>
            <LinkIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={text}
            disabled={busy !== undefined}
            aria-label={t.learn.input}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.learn.placeholder}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              disabled={busy !== undefined || !text.trim()}
            >
              {t.learn.submit}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors select-none hover:bg-muted/50 has-focus-visible:bg-muted/50">
          <UploadIcon className="size-4" />
          <span>{t.learn.drop}</span>
          <input
            type="file"
            className="sr-only"
            disabled={busy !== undefined}
            onChange={(e) => {
              learnFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {pickPath === undefined ? null : (
          <Button
            variant="outline"
            className="h-auto"
            disabled={busy !== undefined}
            onClick={() => {
              pickPath().then(
                (path) => {
                  if (path !== undefined) learn(() => api.learn(path), path);
                },
                (cause: Error) => setError(cause.message),
              );
            }}
          >
            <FolderOpenIcon data-icon="inline-start" />
            {t.learn.choose}
          </Button>
        )}
      </div>
      {busy ? (
        <output className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {busy}
        </output>
      ) : null}
      {error ? <ErrorAlert title={t.learn.error} message={error} /> : null}
      {warnings.length > 0 ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{t.learn.warnings}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** Where an entry came from, as a link when it is one. */
function SourceLine({ entry }: { entry: Learned }) {
  const t = useMessages();
  const source = entry.doc.source;

  if (source === undefined) return <>{t.learn.uploaded}</>;

  if ("path" in source) return <span className="font-mono text-xs">{source.path}</span>;

  const safe = safeHttpUrl(source.url);

  return safe ? (
    <a
      href={safe}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-4"
    >
      {source.url}
    </a>
  ) : (
    <>{source.url}</>
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
      .catch((cause: Error) => toast.error(`${t.learn.forgetError}: ${cause.message}`))
      .finally(() => setBusy(false));
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
        {t.learn.forget}
      </PopoverTrigger>
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

function LearnedCard({
  entry,
  onForgot,
}: {
  entry: Learned;
  onForgot: (rest: LearnedList) => void;
}) {
  const t = useMessages();
  const { doc, dir } = entry;
  const image = doc.images[0];

  return (
    <SelectionArea render={<Card />}>
      {doc.video ? (
        // Saved clips come without caption tracks.
        // oxlint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={fileUrl(`${dir}/${doc.video}`)}
          poster={image ? fileUrl(`${dir}/${image}`) : undefined}
          preload="metadata"
          className="max-h-72 w-full bg-muted object-contain"
          controls
          playsInline
        />
      ) : image ? (
        <img
          src={fileUrl(`${dir}/${image}`)}
          alt=""
          loading="lazy"
          className="max-h-48 w-full bg-muted object-cover"
        />
      ) : null}
      <CardHeader>
        <CardTitle>
          <span className="flex min-w-0 items-center gap-2">
            {doc.icon ? (
              <img
                src={fileUrl(`${dir}/${doc.icon}`)}
                alt=""
                className="size-6 shrink-0 rounded-md"
              />
            ) : null}
            <span className="truncate">{doc.title}</span>
          </span>
        </CardTitle>
        <CardDescription className="min-w-0">
          <span className="block truncate">
            <SourceLine entry={entry} />
          </span>
        </CardDescription>
        <CardAction>
          <ForgetButton entry={entry} onForgot={onForgot} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{t.learn.kinds[doc.kind]}</Badge>
            {doc.site ? <Badge variant="outline">{doc.site}</Badge> : null}
            {entry.unread ? (
              <Badge variant="outline" title={t.learn.unreadHint}>
                {t.learn.unread}
              </Badge>
            ) : null}
          </div>
          {doc.description ? (
            <p className="line-clamp-3 text-muted-foreground">{doc.description}</p>
          ) : null}
        </div>
      </CardContent>
    </SelectionArea>
  );
}

/** What the user taught the workspace about, and about.md as agents read it. */
export function Learn() {
  const t = useMessages();
  const { data, error, reload, setData } = useLive("learned", api.learned);
  const about = data?.about;

  return (
    <Page width="default" title={t.learn.title} description={t.learn.description}>
      <AddSource onLearned={reload} />
      {error ? (
        <ErrorAlert title={t.learn.loadError} message={error} />
      ) : data === undefined ? (
        <ListSkeleton rows={3} />
      ) : data.learned.length === 0 ? (
        <div className="rounded-3xl border border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GraduationCapIcon />
              </EmptyMedia>
              <EmptyTitle>{t.learn.emptyTitle}</EmptyTitle>
              <EmptyDescription>{t.learn.emptyBody}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.learned.map((entry) => (
            <LearnedCard key={entry.id} entry={entry} onForgot={setData} />
          ))}
        </div>
      )}
      {about ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.learn.aboutTitle}</CardTitle>
            <CardDescription>{t.learn.aboutBody}</CardDescription>
            {desktop ? (
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    desktop
                      ?.revealPath(about.path)
                      .catch((cause: Error) => toast.error(cause.message))
                  }
                >
                  <FolderOpenIcon data-icon="inline-start" />
                  {t.learn.showFile}
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <SelectionArea className="typeset typeset-docs">
              {/* about.md marks each learned section with an HTML comment, which is for agents only. */}
              <Markdown remarkPlugins={[remarkGfm]} skipHtml>
                {about.text}
              </Markdown>
            </SelectionArea>
          </CardContent>
        </Card>
      ) : null}
    </Page>
  );
}
