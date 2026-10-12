import { CopyIcon, FilmIcon, InfoIcon, LibraryIcon, LinkIcon, UploadIcon } from "lucide-react";
import { useState, type DragEvent, type SubmitEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { ErrorAlert, ListSkeleton, Page } from "@/components/page";
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
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { safeHttpUrl } from "@/lib/utils";

import { api, fileUrl, type Reference } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { formatTime } from "../lib/time.ts";

const isVideo = (file: File) => file.type.startsWith("video/");

/** Add a reference from a link, or by dropping or choosing a video file. */
function AddReference({ onAdded }: { onAdded: (reference: Reference) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  function add(run: () => Promise<Reference>, label: string, done?: () => void) {
    setBusy(label);
    setError(undefined);
    run()
      .then((reference) => {
        done?.();
        toast.success(`Added "${reference.doc.title}"`);
        onAdded(reference);
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(undefined));
  }

  function addFile(file: File | undefined) {
    if (!file) return;

    if (isVideo(file)) add(() => api.addReferenceFile(file), `Processing ${file.name}…`);
    else toast.error("Choose a video file.");
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    const link = url.trim();

    if (link)
      add(
        () => api.addReferenceUrl(link),
        "Downloading and processing…",
        () => setUrl(""),
      );
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    addFile(event.dataTransfer.files[0]);
  }

  function onDragLeave(event: DragEvent) {
    const into = event.relatedTarget;

    if (!(into instanceof Node && event.currentTarget.contains(into))) setDragging(false);
  }

  return (
    <div
      className={`flex flex-col gap-3 rounded-3xl border p-4 transition-colors ${dragging ? "border-ring bg-muted/50" : ""}`}
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
            type="url"
            value={url}
            disabled={busy !== undefined}
            aria-label="Reference link"
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a TikTok, Reels, or Shorts link"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              variant="default"
              size="sm"
              disabled={busy !== undefined || !url.trim()}
            >
              Add
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/30">
        <UploadIcon className="size-4" />
        <span>Or drop a video file here, or click to browse</span>
        <input
          type="file"
          accept="video/*"
          className="sr-only"
          disabled={busy !== undefined}
          onChange={(e) => {
            addFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {busy ? (
        <output className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {busy}
        </output>
      ) : null}
      {error ? <ErrorAlert title="Could not add that reference" message={error} /> : null}
    </div>
  );
}

export function References({ selected }: { selected: string | undefined }) {
  const { data: refs, error, reload } = useLive("references", api.references);
  const current = refs?.find((r) => r.id === selected);

  function onAdded(reference: Reference) {
    location.hash = href("references", reference.id);
    reload();
  }

  return (
    <Page
      width="wide"
      title="References"
      description={
        refs
          ? `${refs.length} saved. Your agent studies these to learn what works.`
          : "Short videos you like. Your agent studies these to learn what works."
      }
    >
      <AddReference onAdded={onAdded} />
      {error ? (
        <ErrorAlert title="Could not load references" message={error} />
      ) : refs === undefined ? (
        <ListSkeleton rows={4} />
      ) : refs.length === 0 ? (
        <div className="rounded-3xl border border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LibraryIcon />
              </EmptyMedia>
              <EmptyTitle>No references yet</EmptyTitle>
              <EmptyDescription>
                Add a video you wish you had made. Your agent will take it apart and work out why it
                holds attention.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-6">
          <ItemGroup>
            {refs.map((r) => (
              <ReferenceRow key={r.id} reference={r} active={r.id === selected} />
            ))}
          </ItemGroup>
          {current ? (
            <ReferenceDetail reference={current} />
          ) : (
            <div className="rounded-3xl border border-dashed">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilmIcon />
                  </EmptyMedia>
                  <EmptyTitle>{selected ? "Reference not found" : "Pick a reference"}</EmptyTitle>
                  <EmptyDescription>
                    {selected
                      ? "It may have been removed. Choose another one from the list."
                      : "Choose one from the list to watch it and read the analysis."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

function ReferenceRow({ reference: r, active }: { reference: Reference; active: boolean }) {
  const sheet = r.preprocess?.contactSheet;

  return (
    <div className="relative rounded-2xl has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
      <Item variant={active ? "muted" : "default"} size="sm">
        <ItemMedia variant={sheet ? "image" : "icon"}>
          {sheet ? <img src={fileUrl(`${r.dir}/${sheet}`)} alt="" loading="lazy" /> : <FilmIcon />}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            <a
              href={href("references", r.id)}
              aria-current={active ? "page" : undefined}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {r.doc.title}
            </a>
          </ItemTitle>
          <ItemDescription>
            {r.doc.probe ? `${formatTime(r.doc.probe.duration)} · ` : ""}
            {r.analysis ? "Analyzed" : "Not analyzed yet"}
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}

function ReferenceDetail({ reference: r }: { reference: Reference }) {
  const prompt = `Use the content-factory tools to analyze reference "${r.id}": look at its contact sheet and hook frames, then save the analysis with save_reference_analysis.`;
  const source = r.doc.source ? safeHttpUrl(r.doc.source) : undefined;
  const probe = r.doc.probe;
  const sheet = r.preprocess?.contactSheet;

  function copyPrompt() {
    navigator.clipboard
      .writeText(prompt)
      .then(() => toast.success("Prompt copied. Paste it to your agent."))
      .catch((cause: Error) => toast.error(`Could not copy: ${cause.message}`));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{r.doc.title}</CardTitle>
        {r.doc.source ? (
          <CardDescription className="min-w-0">
            <span className="block truncate">
              {source ? (
                <a
                  href={source}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-4"
                >
                  {r.doc.source}
                </a>
              ) : (
                r.doc.source
              )}
            </span>
          </CardDescription>
        ) : null}
        <CardAction>
          <Button variant="outline" size="sm" onClick={copyPrompt}>
            <CopyIcon data-icon="inline-start" />
            {r.analysis ? "Copy re-analysis prompt" : "Copy analysis prompt"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {r.doc.video || sheet ? (
            <div className="flex flex-wrap items-start gap-4">
              {r.doc.video ? (
                // Downloaded clips come without caption tracks.
                // oxlint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={fileUrl(`${r.dir}/${r.doc.video}`)}
                  className="max-h-96 max-w-full rounded-2xl bg-muted"
                  controls
                  playsInline
                />
              ) : null}
              {sheet ? (
                <img
                  src={fileUrl(`${r.dir}/${sheet}`)}
                  alt="Contact sheet of frames from the video"
                  className="max-h-96 max-w-full rounded-2xl border"
                />
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {probe ? (
              <>
                <Badge variant="secondary">{formatTime(probe.duration)}</Badge>
                <Badge variant="secondary">
                  {probe.width}×{probe.height}
                </Badge>
                <Badge variant="secondary">{probe.hasAudio ? "With audio" : "No audio"}</Badge>
              </>
            ) : null}
            {r.preprocess ? (
              <>
                <Badge variant="secondary">{r.preprocess.cuts.length} cuts</Badge>
                <Badge variant="secondary">{r.preprocess.frames.length} frames</Badge>
              </>
            ) : null}
            {r.doc.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
          {r.preprocess && r.preprocess.notes.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {r.preprocess.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <Separator />
          {r.analysis ? (
            <div className="typeset typeset-docs">
              <Markdown remarkPlugins={[remarkGfm]}>{r.analysis}</Markdown>
            </div>
          ) : (
            <Alert>
              <InfoIcon />
              <AlertTitle>Not analyzed yet</AlertTitle>
              <AlertDescription>
                Copy the analysis prompt and give it to your agent. It will watch the video and
                write up how it works.
              </AlertDescription>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
