import { ChevronRightIcon, CircleStopIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MessageHeader } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { AgentStatus } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { answerer } from "../../lib/models.ts";
import {
  closingReply,
  groupSteps,
  toolCounts,
  type RunStep,
  type RunView,
  type ToolStep,
} from "../../lib/run.ts";
import { useRenderLine } from "./render-card.tsx";

/** Past this many stretches of text and tool calls, a finished run folds them away behind its reply. */
const FOLD_STEPS = 4;

/**
 * The agent's answer to one message: the steps it took, its reply, and how it ended. The message
 * adds what it offers next.
 */
export function RunReport({
  run,
  statuses,
  onStop,
}: {
  run: RunView;
  /** What the agents list, to name the model the run used. */
  statuses?: ReadonlyArray<AgentStatus> | undefined;
  onStop: () => void;
}) {
  const { steps, reply } = closingReply(run.steps, run.reply);
  const t = useMessages();
  const rendering = useRenderLine();

  return (
    <>
      <MessageHeader>{answerer(run.agent, run, statuses, t)}</MessageHeader>
      {steps.length > 0 ? <Steps steps={steps} running={run.running} /> : null}
      {reply === undefined ? null : <Reply text={reply} />}
      {run.running ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {run.compacting ? t.chat.compacting : (rendering ?? t.chat.working)}
          <Button variant="ghost" size="xs" onClick={onStop}>
            <CircleStopIcon data-icon="inline-start" />
            {t.chat.stop}
          </Button>
        </div>
      ) : null}
      {run.status === "failed" ? (
        <Bubble variant="destructive">
          <BubbleContent>
            <p className="whitespace-pre-wrap">{run.error ?? t.chat.failed}</p>
          </BubbleContent>
        </Bubble>
      ) : null}
      {run.status === "stopped" ? (
        <p className="text-sm text-muted-foreground">{t.chat.stopped}</p>
      ) : null}
    </>
  );
}

/**
 * What the agent did on the way: what it said, with each run of tool calls summed up in a line
 * that opens to list them. Once it is done, many of these fold away behind the reply.
 */
function Steps({ steps, running }: { steps: ReadonlyArray<RunStep>; running: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const t = useMessages();
  const segments = groupSteps(steps);

  if (!running && segments.length > FOLD_STEPS && !expanded) {
    const taken = steps.filter((step) => step.kind !== "compaction").length;

    // A saved run keeps only that it compacted, so the folded one still shows it too.
    return (
      <>
        <Button variant="ghost" size="xs" className="self-start" onClick={() => setExpanded(true)}>
          <WrenchIcon data-icon="inline-start" />
          {t.chat.showSteps(taken)}
        </Button>
        {segments.some((segment) => segment.kind === "compaction") ? <CompactionLine /> : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {segments.map((segment, index) => {
        if (segment.kind === "text") return <Reply key={segment.key} text={segment.text} />;

        if (segment.kind === "compaction") return <CompactionLine key={segment.key} />;

        const [only] = segment.tools;

        // One call says no more than a summary of it would.
        if (segment.tools.length === 1 && only !== undefined) {
          return <ToolLine key={segment.key} tool={only} />;
        }

        const active = running && index === segments.length - 1;

        return <ToolGroup key={segment.key} tools={segment.tools} active={active} />;
      })}
    </div>
  );
}

/**
 * Tool calls in a row, closed to a summary as Claude Code and Codex show them. While the agent is
 * still on them, the call it made last shows under the summary.
 */
function ToolGroup({ tools, active }: { tools: ReadonlyArray<ToolStep>; active: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useMessages();
  const latest = tools.at(-1);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button variant="ghost" size="xs" />}>
        <WrenchIcon data-icon="inline-start" />
        {t.chat.toolSummary(toolCounts(tools))}
        <ChevronRightIcon data-icon="inline-end" className={open ? "rotate-90" : undefined} />
      </CollapsibleTrigger>
      {active && !open && latest !== undefined ? (
        <div className="mt-1.5 ml-3.5 border-l pl-3">
          <ToolLine tool={latest} />
        </div>
      ) : null}
      <CollapsibleContent>
        <div className="mt-1.5 ml-3.5 flex max-h-64 flex-col gap-1.5 overflow-y-auto border-l pl-3">
          {tools.map((tool, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- calls only ever append, so position is identity
            <ToolLine key={index} tool={tool} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Where the agent compacted the conversation and went on from a summary of it, drawn across the
 * steps as Claude Code marks it in its own transcript.
 */
function CompactionLine() {
  const t = useMessages();

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div aria-hidden className="h-px flex-1 bg-border" />
      <Tooltip>
        <TooltipTrigger render={<span />}>{t.chat.compacted}</TooltipTrigger>
        <TooltipContent>{t.chat.compactedHint}</TooltipContent>
      </Tooltip>
      <div aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

function ToolLine({ tool }: { tool: ToolStep }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
      <WrenchIcon className="size-3 shrink-0" />
      <span className="shrink-0 font-medium text-foreground">{tool.name}</span>
      {tool.detail === undefined ? null : <span className="truncate">{tool.detail}</span>}
    </div>
  );
}

export function Reply({ text }: { text: string }) {
  return (
    <div className="typeset typeset-chat">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}
