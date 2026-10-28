import { Option } from "effect";
import { ArrowRightIcon } from "lucide-react";

import { PlatformIcon } from "@/components/platform-icon";
import { Skeleton } from "@/components/ui/skeleton";

import type { ImportSummary } from "../api.ts";
import { useMessages } from "../i18n/index.ts";
import { parseIdea, type Idea } from "../lib/ideas.ts";
import { replyBlocks } from "../lib/replyBlocks.ts";
import { openNewItemWith } from "./new-item-dialog.tsx";

/** The first videos the last reading of the user's material suggested, once it has finished. */
export function ideasIn(imports: ReadonlyArray<ImportSummary> | undefined): ReadonlyArray<Idea> {
  const reading = imports
    ?.filter(({ doc }) => doc.kind === "learn")
    .reduce<ImportSummary | undefined>(
      (latest, one) =>
        latest === undefined || one.doc.created > latest.doc.created ? one : latest,
      undefined,
    );

  if (reading === undefined || reading.running) return [];

  const reply = reading.doc.turns.at(-1)?.run?.reply;

  return reply === undefined ? [] : (replyBlocks(reply).ideas ?? []).map(parseIdea);
}

/**
 * The videos the agent suggests from what it read, so the first one is the user's own and asks
 * nothing of them but a pick. Each opens New video with the whole request written in.
 */
export function FirstIdeas({ ideas }: { ideas: ReadonlyArray<Idea> }) {
  return (
    <ul className="flex w-full animate-in flex-col gap-2 duration-300 fade-in">
      {ideas.map((idea) => (
        <li key={idea.title}>
          <IdeaCard idea={idea} />
        </li>
      ))}
    </ul>
  );
}

/** Where the cards will be while the agent is still reading. */
export function IdeasLoading() {
  return (
    <div className="flex w-full flex-col gap-2" aria-hidden>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  const t = useMessages();
  const platform = Option.map(idea.platform, (one) => t.start.brief.platform[one]);
  const seconds = Option.getOrUndefined(idea.seconds);
  const meta = t.board.ideaMeta(Option.getOrUndefined(platform), seconds);

  return (
    <button
      type="button"
      onClick={() =>
        openNewItemWith(t.board.ideaPrompt(Option.getOrUndefined(platform), seconds, idea.title))
      }
      className="group flex w-full items-center gap-3 rounded-2xl bg-foreground/8 py-3 pr-4 pl-3 text-left ring-1 ring-transparent transition outline-none ring-inset hover:bg-brand/10 hover:ring-brand focus-visible:bg-brand/10 focus-visible:ring-brand"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background/70">
        {Option.isSome(idea.platform) ? (
          <PlatformIcon platform={idea.platform.value} className="size-5" />
        ) : (
          <ArrowRightIcon className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm font-medium text-pretty">{idea.title}</span>
        {meta === "" ? null : <span className="text-xs text-muted-foreground">{meta}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-brand group-focus-visible:text-brand">
        {t.board.make}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
