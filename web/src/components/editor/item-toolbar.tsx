import { Option } from "effect";
import { ArrowLeftIcon, DownloadIcon, KeyboardIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";

import { StatusDot } from "@/components/status-dot";
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
import { downloadFile } from "../../lib/download.ts";
import { EDIT_KEYS, type EditCommand } from "../../lib/edit-commands.ts";
import { exportName } from "../../lib/exportName.ts";
import { redoable, undoable } from "../../lib/history.ts";
import { agentTitle } from "../../lib/models.ts";
import { sendFailed } from "../../lib/notify.ts";
import type { LiveRun } from "../../lib/run.ts";
import { Hint, keepFocus } from "./hint.tsx";

/**
 * The item's title bar: back to the board, what the agent is doing, undo and redo, exporting the
 * media shown with a warning when it breaks an upload rule, and status.
 */
export function Toolbar({
  item,
  media,
  running,
  agent,
  asking,
  onItem,
  onEdit,
  onShortcuts,
}: {
  item: ItemDetail;
  /** The media file shown, from the workspace's root, to download; none while there is none. */
  media: string | undefined;
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

  function exportMedia(path: string) {
    downloadFile(path, exportName(item.doc.title, path, item.media.length > 1));
    api.pruneVersions(item.id).then(onItem, sendFailed);
    api.verify(item.id).then((reports) => {
      const failed = reports
        .find((report) => path.endsWith(`/${report.file}`))
        ?.checks.filter((check) => !check.ok);

      if (failed !== undefined && failed.length > 0)
        toast.warning(t.item.uploadWarning, {
          description: failed.map((check) => `${check.name}: ${check.detail}`).join("\n"),
        });
    }, sendFailed);
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <a href={href("board")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeftIcon data-icon="inline-start" />
        {t.nav.board}
      </a>
      <h1 className="min-w-0 truncate text-sm font-medium">{item.doc.title}</h1>
      {running && asking !== undefined ? (
        <Badge variant="outline">
          <span className="size-1.5 rounded-full bg-selection" />
          {t.item.asking(agentTitle(Option.fromUndefinedOr(agent), t), asking === "question")}
        </Badge>
      ) : running ? (
        <Badge variant="secondary">
          <Spinner data-icon="inline-start" />
          {t.item.editing(agentTitle(Option.fromUndefinedOr(agent), t))}
        </Badge>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Hint label={t.history.undo} keys={EDIT_KEYS.undo}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.history.undo}
            disabled={running || Option.isNone(undoable(item.history))}
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
            disabled={running || Option.isNone(redoable(item.history))}
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
      {media === undefined ? null : (
        <Button variant="outline" size="sm" onClick={() => exportMedia(media)}>
          <DownloadIcon data-icon="inline-start" />
          {t.item.download}
        </Button>
      )}
      <Select
        items={statuses}
        value={item.doc.status}
        onValueChange={(status: Status | null) => {
          if (status !== null) api.updateItem(item.id, { status }).then(onItem, sendFailed);
        }}
      >
        <SelectTrigger size="sm" variant="ghost" aria-label={t.item.status}>
          <StatusDot status={item.doc.status} />
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
