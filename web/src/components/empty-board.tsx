import { BookOpenIcon, PlusIcon } from "lucide-react";

import { AccessLink } from "@/components/mac-access";
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

import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { openNewVideo } from "../lib/firstVideo.ts";
import { useFirstReading } from "./first-ideas.tsx";

/**
 * The board before the first video, with one thing to do: New video, with what the agent knows
 * beside it, or, while it reads the first launch's material, that it is reading. Turning on what
 * helps the agent waits underneath.
 */
export function EmptyBoard() {
  const t = useMessages();
  const { titles, reading } = useFirstReading();

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <StackMark />
        </EmptyMedia>
        <EmptyTitle>{t.board.emptyTitle}</EmptyTitle>
        {reading && titles.length > 0 ? (
          <EmptyDescription>
            <span className="inline-flex items-center gap-1.5">
              <Spinner className="size-3.5" />
              {t.board.reading(titles)}
            </span>
          </EmptyDescription>
        ) : (
          <EmptyDescription>{t.board.emptyBody}</EmptyDescription>
        )}
      </EmptyHeader>
      <EmptyContent>
        <Button size="lg" onClick={() => openNewVideo()}>
          <PlusIcon data-icon="inline-start" />
          {t.newItem.open}
        </Button>
        {!reading && titles.length > 0 ? <KnownLink label={t.board.known(titles)} /> : null}
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
