import { ArrowLeftIcon, KeyboardIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import { api, STATUSES, type ItemDetail, type Status } from "../../api.ts";
import { href } from "../../hooks.ts";
import { useMessages } from "../../i18n/index.ts";
import { EDIT_KEYS, type EditCommand } from "../../lib/edit-commands.ts";
import { redoable, undoable } from "../../lib/history.ts";
import { agentLabel } from "../../lib/models.ts";
import type { LiveRun } from "../../lib/run.ts";
import { Hint, keepFocus } from "./hint.tsx";

const showError = (cause: Error) => {
  toast.error(cause.message);
};

/** The item's title bar: back to the board, what the agent is doing, undo and redo, and status. */
export function Toolbar({
  item,
  running,
  agent,
  asking,
  onItem,
  onEdit,
  onShortcuts,
}: {
  item: ItemDetail;
  running: boolean;
  agent: LiveRun["agent"];
  /** What the agent waits on the user for: a tool it asks to use, or its questions. */
  asking: "approval" | "question" | undefined;
  onItem: (item: ItemDetail) => void;
  onEdit: (command: EditCommand) => void;
  onShortcuts: () => void;
}) {
  const t = useMessages();
  const statuses = STATUSES.map((status) => ({ value: status, label: t.status[status] }));

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <a href={href("board")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeftIcon data-icon="inline-start" />
        {t.nav.board}
      </a>
      <h1 className="min-w-0 truncate text-sm font-semibold">{item.doc.title}</h1>
      {running && asking !== undefined ? (
        <Badge variant="outline">
          <span className="size-1.5 rounded-full bg-selection" />
          {t.item.asking(agentLabel(agent) ?? t.chat.agent, asking === "question")}
        </Badge>
      ) : running ? (
        <Badge variant="secondary">
          <Spinner data-icon="inline-start" />
          {t.item.editing(agentLabel(agent) ?? t.chat.agent)}
        </Badge>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Hint label={t.history.undo} keys={EDIT_KEYS.undo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.history.undo}
            disabled={running || undoable(item.history) === undefined}
            onMouseDown={keepFocus}
            onClick={() => onEdit("undo")}
          >
            <Undo2Icon />
          </Button>
        </Hint>
        <Hint label={t.history.redo} keys={EDIT_KEYS.redo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.history.redo}
            disabled={running || redoable(item.history) === undefined}
            onMouseDown={keepFocus}
            onClick={() => onEdit("redo")}
          >
            <Redo2Icon />
          </Button>
        </Hint>
        <Hint label={t.shortcuts.open} keys="?">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.shortcuts.open}
            onMouseDown={keepFocus}
            onClick={onShortcuts}
          >
            <KeyboardIcon />
          </Button>
        </Hint>
      </div>
      <Select
        items={statuses}
        value={item.doc.status}
        onValueChange={(status: Status | null) => {
          if (status !== null) api.updateItem(item.id, { status }).then(onItem, showError);
        }}
      >
        <SelectTrigger size="sm" aria-label={t.item.status}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {statuses.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
