import {
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import {
  api,
  fileUrl,
  type ItemDetail,
  type Media,
  type MediaReport,
  type MediaReview,
} from "../../api.ts";
import { href, useLive } from "../../hooks.ts";
import { useLocale, useMessages } from "../../i18n/index.ts";
import { fixPrompt, templateState } from "../../lib/templates.ts";
import { formatAgo, formatTime } from "../../lib/time.ts";
import { copyPrompt } from "./composer.tsx";

const showError = (cause: Error) => {
  toast.error(cause.message);
};

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

/**
 * What stands between the item and a good upload: whether its template is ready and what renders are
 * held to, the frames the agent last judged each video by, and the platforms' upload rules.
 */
export function Checks({ item }: { item: ItemDetail }) {
  return (
    <div className="flex flex-col gap-6">
      {item.doc.format === undefined ? null : <TemplateCheck id={item.doc.format} />}
      <FrameReviews item={item} />
      <UploadChecks id={item.id} />
    </div>
  );
}

function TemplateCheck({ id }: { id: string }) {
  const t = useMessages();
  const { data: statuses } = useLive("formats-status", api.formatStatuses);
  const { data: ws } = useLive("workspace", api.workspace);

  if (statuses === undefined) return null;

  const status = statuses.find((s) => s.id === id);

  if (status === undefined) {
    return (
      <Section title={t.checks.template}>
        <p className="text-muted-foreground">{t.checks.templateMissing(id)}</p>
      </Section>
    );
  }

  const state = templateState(status);
  const checklist = status.format?.doc.checklist ?? [];

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          {t.checks.template}
          <a
            href={href("templates", id)}
            className="font-normal underline-offset-4 hover:underline"
          >
            {status.format?.doc.title ?? id}
          </a>
          <Badge variant={state === "ready" ? "secondary" : "destructive"}>
            {t.templates.state[state]}
          </Badge>
        </span>
      }
    >
      {state === "ready" ? null : (
        <Alert variant={state === "broken" ? "destructive" : "default"}>
          <TriangleAlertIcon />
          <AlertTitle>
            {state === "broken" ? t.templates.brokenTitle : t.templates.incompleteTitle}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {status.check.problems.map((p) => (
                <li key={`${p.kind}:${p.subject}:${p.message}`}>{p.message}</li>
              ))}
            </ul>
            {ws === undefined ? null : (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => copyPrompt(fixPrompt(id, ws.root))}
              >
                <CopyIcon data-icon="inline-start" />
                {t.templates.copyFix}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {checklist.length === 0 ? null : (
        <>
          <p className="text-muted-foreground">{t.checks.checklist}</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {checklist.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function FrameReviews({ item }: { item: ItemDetail }) {
  const t = useMessages();
  const videos = item.media.filter((media) => media.kind === "video");

  if (videos.length === 0) return null;

  const reviews = new Map(item.reviews.map((review) => [review.file, review]));
  const unreviewed = videos.filter((video) => !reviews.has(video.name));

  return (
    <Section title={t.checks.frames}>
      <p className="text-muted-foreground">{t.checks.framesBody}</p>
      {videos.map((video) => {
        const review = reviews.get(video.name);

        return review === undefined ? null : (
          <FrameReview key={video.name} review={review} video={video} />
        );
      })}
      {unreviewed.length === 0 ? null : (
        <div className="flex flex-col gap-1 text-muted-foreground">
          {unreviewed.map((video) => (
            <p key={video.name}>{t.checks.noReview(video.name)}</p>
          ))}
          <p>{t.checks.noReviewHint}</p>
        </div>
      )}
    </Section>
  );
}

function FrameReview({ review, video }: { review: MediaReview; video: Media }) {
  const t = useMessages();
  const locale = useLocale();
  const at = Date.parse(review.at);
  // The review rewrites its files under the same names, so its time keeps the browser from showing old ones.
  const url = (file: string) => fileUrl(`${review.dir}/${file}`, at);

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{video.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t.checks.reviewed(formatAgo(review.at, locale))}
        </span>
      </p>
      {video.mtime > at ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlertIcon className="size-3.5" />
          {t.checks.stale}
        </p>
      ) : null}
      {review.sheet === undefined ? null : (
        <Zoomable src={url(review.sheet)} title={t.checks.sheet(video.name)} />
      )}
      {review.strips.map((strip) => (
        <figure key={strip.file} className="flex flex-col gap-1">
          <Zoomable src={url(strip.file)} title={t.checks.strip(formatTime(strip.t))} />
          <figcaption className="text-xs text-muted-foreground">
            {t.checks.strip(formatTime(strip.t))}
          </figcaption>
        </figure>
      ))}
      {review.notes.length === 0 ? null : (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {review.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** An image that opens full size, since a sheet of frames is too small to read in the panel. */
function Zoomable({ src, title }: { src: string; title: string }) {
  return (
    <Dialog>
      <DialogTrigger render={<button type="button" aria-label={title} className="select-none" />}>
        <img
          src={src}
          alt=""
          loading="lazy"
          className="w-full cursor-zoom-in rounded-md ring-1 ring-foreground/10 in-focus-visible:ring-2 in-focus-visible:ring-ring"
        />
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl">
        <DialogTitle>{title}</DialogTitle>
        <img src={src} alt={title} className="max-h-[80vh] w-full object-contain" />
      </DialogContent>
    </Dialog>
  );
}

/** Whether each video will upload: length, shape, size and encoding, from the workspace's rules. */
function UploadChecks({ id }: { id: string }) {
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
    <Section title={t.checks.rules}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">{t.checks.rulesBody}</p>
        <Button variant="outline" size="sm" disabled={checking} onClick={check}>
          {checking ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheckIcon data-icon="inline-start" />
          )}
          {reports === undefined ? t.checks.run : t.checks.runAgain}
        </Button>
      </div>
      {reports?.length === 0 ? <p className="text-muted-foreground">{t.checks.noVideos}</p> : null}
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
            {report.checks.map((entry) => (
              <li
                key={entry.name}
                className={cn("text-xs", entry.ok ? "text-muted-foreground" : "text-destructive")}
              >
                <span className="font-medium">{entry.name}</span>: {entry.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}
