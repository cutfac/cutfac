import { BookOpenIcon, PencilLineIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";

import { AccessLink } from "@/components/mac-access";
import { NewItemTrigger } from "@/components/new-item-dialog";
import { NotifyLink } from "@/components/notify-row";
import { StackMark } from "@/components/stack-mark";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

import { api } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { FirstIdeas, IdeasLoading, ideasIn } from "./first-ideas.tsx";

/** How often the empty board looks again while the agent reads; the file watcher skips imports. */
const READING_POLL_MS = 3000;

/**
 * The board before the first video, with one thing to do at a time: while the agent reads the
 * first launch's material, that it is reading; then the videos it suggests, as the way in, with
 * writing one's own below; with none, New video. Turning on what helps the agent waits underneath.
 */
export function EmptyBoard() {
  const t = useMessages();
  const learned = useLive("learned", api.learned);
  const imports = useLive("imports", api.imports);
  const titles = learned.data?.learned.map((one) => one.doc.title) ?? [];
  const ideas = ideasIn(imports.data);

  const reading =
    imports.data?.some(({ doc, running }) => doc.kind === "learn" && !doc.closed && running) ??
    false;

  const reload = useEffectEvent(() => {
    learned.reload();
    imports.reload();
  });

  useEffect(() => {
    if (!reading) return;

    const timer = setInterval(reload, READING_POLL_MS);

    return () => clearInterval(timer);
  }, [reading]);

  // Once the reading ends, what it wrote shows.
  const wasReading = useRef(false);

  useEffect(() => {
    if (wasReading.current && !reading) reload();

    wasReading.current = reading;
  }, [reading]);

  const writeOwn = (
    <NewItemTrigger
      render={
        <Button size="sm" variant="ghost">
          <PencilLineIcon data-icon="inline-start" />
          {t.board.writeOwn}
        </Button>
      }
    />
  );

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <StackMark />
        </EmptyMedia>
        <EmptyTitle>{ideas.length > 0 ? t.board.ideasTitle : t.board.emptyTitle}</EmptyTitle>
        {reading && titles.length > 0 ? (
          <EmptyDescription>
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="size-3.5" />
              {t.board.reading(titles)}
            </span>
          </EmptyDescription>
        ) : ideas.length > 0 ? null : (
          <EmptyDescription>{t.board.emptyBody}</EmptyDescription>
        )}
      </EmptyHeader>
      <EmptyContent>
        {reading && titles.length > 0 ? (
          <>
            <IdeasLoading />
            {writeOwn}
          </>
        ) : ideas.length > 0 ? (
          <>
            <KnownLink label={t.board.ideasFrom(titles)} />
            <FirstIdeas ideas={ideas} />
            {writeOwn}
          </>
        ) : (
          <>
            <NewItemTrigger />
            {titles.length > 0 ? <KnownLink label={t.board.known(titles)} /> : null}
          </>
        )}
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          <AccessLink />
          <NotifyLink />
        </div>
      </EmptyContent>
    </Empty>
  );
}

/** What the agent knows, which opens the page of everything it learned. */
function KnownLink({ label }: { label: string }) {
  return (
    <a href={href("learn")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
      <BookOpenIcon data-icon="inline-start" />
      <span className="truncate">{label}</span>
    </a>
  );
}
