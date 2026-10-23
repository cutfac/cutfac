import { ChevronRightIcon, CircleStopIcon, XIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { SelectionArea } from "@/components/selection-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useMessages, type Messages } from "../../i18n/index.ts";
import {
  RENDER_STAGES,
  renderShare,
  spanTime,
  timeLeft,
  type RenderState,
} from "../../lib/render.ts";
import { onItemRender, stopRender } from "../../renderApi.ts";

/** How long a finished render's card stays before it fades. */
const DONE_FOR = 4000;

/** The beside card's width, as `w-72`. */
const CARD_WIDTH = 288;

/** The gap that keeps the beside card off the frame and the edge. */
const CARD_GAP = 16;

/** What the board shows of the item's render: Cutfac's own, or one the agent runs in its shell. */
export interface RenderView {
  /** The render the card shows, while it runs and for a moment after it ends. */
  readonly render: RenderState | undefined;
  /** The command of a render the agent runs in its shell, whose progress the board can't read. */
  readonly shell: string | undefined;
  /** Versions rendered so far this visit, by label, oldest first. */
  readonly versions: ReadonlyArray<RenderState>;
  readonly dismiss: () => void;
  readonly stop: () => void;
}

interface Seen {
  readonly latest: RenderState | undefined;
  readonly live: ReadonlyMap<number, RenderState>;
}

/**
 * Follow the item's render. When one seen running finishes, `onDone` gets it, so the preview can
 * switch to what it wrote.
 */
export function useItemRender(
  id: string,
  shell: string | undefined,
  onDone: (render: RenderState) => void,
): RenderView {
  /** The item's latest render, and those seen running, by when they started: only those show their end. */
  const [seen, setSeen] = useState<Seen | undefined>(undefined);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const done = useEffectEvent(onDone);

  useEffect(() => {
    const live = new Map<number, RenderState>();

    return onItemRender(id, (latest) => {
      const before = latest === undefined ? undefined : live.get(latest.startedAt);

      if (latest !== undefined && (before !== undefined || latest.status === "running")) {
        live.set(latest.startedAt, latest);
      }

      setSeen({ latest, live: new Map(live) });

      if (before?.status === "running" && latest?.status === "done") done(latest);
    });
  }, [id]);

  const latest = seen?.latest;

  const render =
    latest !== undefined &&
    seen?.live.has(latest.startedAt) === true &&
    !hidden.has(latest.startedAt)
      ? latest
      : undefined;

  const dismiss = () => {
    if (render !== undefined) setHidden((all) => new Set(all).add(render.startedAt));
  };

  // A finished or stopped render's card fades on its own; a failed one stays to be read.
  useEffect(() => {
    if (render === undefined || render.status === "running" || render.status === "failed") return;

    const timer = setTimeout(() => {
      setHidden((all) => new Set(all).add(render.startedAt));
    }, DONE_FOR);

    return () => clearTimeout(timer);
  }, [render]);

  const stop = () => {
    stopRender(id).catch((cause: Error) => toast.error(cause.message));
  };

  const versions = [...(seen?.live.values() ?? [])].filter(
    (version) => version.label !== undefined,
  );

  return { render, shell: render === undefined ? shell : undefined, versions, dismiss, stop };
}

/** The current time, ticking each second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!on) return;

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [on]);

  return now;
}

const RenderContext = createContext<RenderView | undefined>(undefined);

export const RenderProvider = RenderContext.Provider;

/** The chat's line while a render runs: `Rendering 27%`, or `undefined` when none does. */
export function useRenderLine(): string | undefined {
  const view = useContext(RenderContext);
  const t = useMessages();

  if (view?.shell !== undefined) return t.render.rendering;

  const render = view?.render;

  return render?.status === "running" ? runningLine(render, t) : undefined;
}

/** `Rendering 27%`, or just `Rendering` while it can't tell how far. */
function runningLine(render: RenderState, t: Messages) {
  const share = renderShare(render);

  return share === undefined ? t.render.rendering : t.render.percent(Math.round(share * 100));
}

/** The size of `element`, kept current as it changes. */
function useSize(element: HTMLElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (element === null) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();

      setSize({ width, height });
    };

    const observer = new ResizeObserver(measure);

    observer.observe(element);
    measure();

    return () => observer.disconnect();
  }, [element]);

  return size;
}

/** Where the stage draws a frame of `ratio`, centred and as large as `size` lets it be. */
function frameIn(size: { width: number; height: number }, ratio: number) {
  const width = Math.min(size.width, size.height * ratio);

  return { width, left: (size.width - width) / 2, top: (size.height - width / ratio) / 2 };
}

/**
 * The preview with its render beside it: a card in the room right of a tall frame, or a line
 * under it when the frame leaves no room. `previous` marks the frame as the version being
 * replaced.
 */
export function RenderFrame({
  view,
  ratio,
  previous,
  children,
}: {
  view: RenderView;
  /** Width over height of the frame the stage draws. */
  ratio: number;
  previous: boolean;
  children: ReactNode;
}) {
  const [outer, setOuter] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const t = useMessages();
  const showing = view.render !== undefined || view.shell !== undefined;
  // Decided on the whole area, line included: the line under the frame shrinks the stage, which
  // would otherwise make room beside it and flip the card back and forth.
  const beside = frameIn(useSize(outer), ratio).left >= CARD_WIDTH + CARD_GAP * 2;
  const { width: frameWidth, left, top } = frameIn(useSize(box), ratio);

  return (
    <div ref={setOuter} className="flex min-h-0 flex-1 flex-col">
      <div ref={setBox} className="relative flex min-h-0 flex-1 flex-col">
        {children}
        {previous && showing ? (
          <Badge
            variant="secondary"
            className="pointer-events-none absolute top-(--top) left-(--left) m-3"
            style={{ "--top": `${top}px`, "--left": `${left}px` }}
          >
            {t.render.previous}
          </Badge>
        ) : null}
        {showing && beside ? (
          <div
            className="absolute top-1/2 left-(--beside) w-72 -translate-y-1/2"
            style={{ "--beside": `${left + frameWidth + CARD_GAP}px` }}
          >
            <RenderCard view={view} />
          </div>
        ) : null}
      </div>
      {showing && !beside ? <RenderCard view={view} compact /> : null}
    </div>
  );
}

function RenderCard({ view, compact = false }: { view: RenderView; compact?: boolean }) {
  const { render, shell } = view;
  const now = useNow(render?.status === "running" || shell !== undefined);
  const t = useMessages();

  if (render === undefined) {
    return <ShellCard key={shell} command={shell} now={now} compact={compact} />;
  }

  const running = render.status === "running";
  const elapsed = (render.endedAt ?? now) - render.startedAt;
  const share = renderShare(render);
  const left = running ? timeLeft(elapsed, share) : undefined;
  const { progress } = render;
  const stage = RENDER_STAGES.indexOf(progress.stage);
  const done = render.status === "done";

  /** A stage is ticked once passed, current while it runs, and dim until then. */
  const stageClass = (index: number) => {
    if (index < stage || done) return "text-muted-foreground";

    return index === stage ? "font-medium text-foreground" : "text-muted-foreground/60";
  };

  return (
    <div className={cardClass(compact)}>
      <div className="flex items-center gap-2">
        {running ? <Spinner /> : null}
        <span className="min-w-0 truncate font-medium">{headline(render, elapsed, t)}</span>
        {render.label === undefined ? null : (
          <Badge variant="outline" className="shrink-0">
            {render.label}
          </Badge>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          {running ? (
            <Button variant="ghost" size="xs" onClick={view.stop}>
              <CircleStopIcon data-icon="inline-start" />
              {t.render.stop}
            </Button>
          ) : null}
          {render.status === "failed" ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={view.dismiss}
              aria-label={t.common.close}
            >
              <XIcon />
            </Button>
          ) : null}
        </span>
      </div>
      {running || done ? (
        <>
          <ol className="flex gap-3 text-xs">
            {RENDER_STAGES.map((name, index) => (
              <li key={name} className={stageClass(index)}>
                {index < stage || done ? "✓ " : null}
                {t.render.stages[name]}
              </li>
            ))}
          </ol>
          <Progress value={share === undefined ? null : Math.round(share * 100)} />
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {progress.unit === "frames" &&
            progress.done !== undefined &&
            progress.total !== undefined ? (
              <span>{t.render.frames(progress.done, progress.total)}</span>
            ) : null}
            {running ? <span>{t.render.elapsed(spanTime(elapsed))}</span> : null}
            {left === undefined ? null : (
              <span className="ml-auto">{t.render.left(spanTime(left))}</span>
            )}
          </div>
        </>
      ) : null}
      {render.status === "failed" ? (
        <p className="text-xs text-muted-foreground">{t.render.fixing}</p>
      ) : null}
      {compact && render.status !== "failed" ? null : (
        <RenderLog log={render.log} failed={render.status === "failed"} />
      )}
      {view.versions.length > 1 ? <Versions versions={view.versions} /> : null}
    </div>
  );
}

/** A render the agent runs in its shell: timed from when the board noticed it. */
function ShellCard({
  command,
  now,
  compact,
}: {
  command: string | undefined;
  now: number;
  compact: boolean;
}) {
  const [since] = useState(Date.now);
  const t = useMessages();

  return (
    <div className={cn(cardClass(compact), "text-muted-foreground")}>
      <div className="flex items-center gap-2 text-foreground">
        <Spinner />
        {t.render.rendering}
        <span className="ml-auto text-muted-foreground tabular-nums">
          {spanTime(Math.max(0, now - since))}
        </span>
      </div>
      {compact ? null : (
        <>
          <SelectionArea className="truncate font-mono text-xs">{command}</SelectionArea>
          <p className="text-xs">{t.render.shell}</p>
        </>
      )}
    </div>
  );
}

const cardClass = (compact: boolean) =>
  cn(
    "flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-sm",
    "animate-in fade-in",
    compact && "mx-4 mb-2 gap-1.5 py-2",
  );

function headline(render: RenderState, elapsed: number, t: Messages) {
  switch (render.status) {
    case "running":
      return runningLine(render, t);
    case "done":
      return t.render.done(spanTime(elapsed));
    case "failed":
      return t.render.failed;
    case "stopped":
      return t.render.stopped;
  }
}

/** What the render printed last, open from the start when it failed. */
function RenderLog({ log, failed }: { log: ReadonlyArray<string>; failed: boolean }) {
  const [chosen, setOpen] = useState<boolean | undefined>(undefined);
  const open = chosen ?? failed;
  const t = useMessages();

  if (log.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="-ml-2" />}>
        {t.render.log}
        <ChevronRightIcon data-icon="inline-end" className={open ? "rotate-90" : undefined} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SelectionArea className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
          {log.join("\n")}
        </SelectionArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

function versionState(version: RenderState, t: Messages) {
  switch (version.status) {
    case "done":
      return "✓";
    case "running": {
      const share = renderShare(version);

      return share === undefined ? t.render.rendering : `${Math.round(share * 100)}%`;
    }

    case "failed":
      return t.render.failed;
    case "stopped":
      return t.render.stopped;
  }
}

/** Each version rendered this visit, as `v1 ✓ · v2 41%`. */
function Versions({ versions }: { versions: ReadonlyArray<RenderState> }) {
  const t = useMessages();

  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {versions.map((version) => `${version.label} ${versionState(version, t)}`).join(" · ")}
    </p>
  );
}
