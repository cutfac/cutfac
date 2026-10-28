import { ArrowRightIcon } from "lucide-react";

import { api, type ImportSummary } from "../api.ts";
import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { replyBlocks } from "../lib/replyBlocks.ts";
import { openNewItemWith } from "./new-item-dialog.tsx";

/** The first videos the last reading of the user's material suggested, once it has finished. */
function useIdeas(): ReadonlyArray<string> {
  const imports = useLive("imports", api.imports);

  const reading = imports.data
    ?.filter(({ doc }) => doc.kind === "learn")
    .reduce<ImportSummary | undefined>(
      (latest, one) =>
        latest === undefined || one.doc.created > latest.doc.created ? one : latest,
      undefined,
    );

  if (reading === undefined || reading.running) return [];

  const reply = reading.doc.turns.at(-1)?.run?.reply;

  return reply === undefined ? [] : (replyBlocks(reply).ideas ?? []);
}

/**
 * On the empty board, the videos the agent suggests from what it read, so the first one is the
 * user's own and asks nothing of them but a pick. Each opens New video with it written in.
 */
export function FirstIdeas() {
  const t = useMessages();
  const ideas = useIdeas();

  if (ideas.length === 0) return null;

  return (
    <section className="flex w-full animate-in flex-col gap-2 duration-300 fade-in">
      <h2 className="text-xs text-muted-foreground">{t.board.ideas}</h2>
      <ul className="flex flex-col gap-2">
        {ideas.map((idea) => (
          <li key={idea}>
            <button
              type="button"
              onClick={() => openNewItemWith(idea)}
              className="group flex w-full items-center gap-3 rounded-2xl bg-foreground/6 px-4 py-3 text-left text-sm transition-colors outline-none hover:bg-foreground/10 focus-visible:bg-foreground/10"
            >
              <span className="min-w-0 flex-1">{idea}</span>
              <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
