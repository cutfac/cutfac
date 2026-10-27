import { Match } from "effect";
import { CheckIcon, ChevronsUpDownIcon, FolderOpenIcon, PlusIcon } from "lucide-react";
import { useId, useState, type SubmitEvent } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";

import type { WorkspaceInfo } from "../api.ts";
import { desktop, type LibraryWorkspaces } from "../desktop.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

/** Ask for any folder to open as a workspace, beyond the ones in the app's folder. */
export function openWorkspace() {
  // The desktop shell reloads the window itself once the new workspace is serving.
  desktop?.openWorkspace().catch((cause: Error) => toast.error(cause.message));
}

/**
 * The brand mark, as on the app icon and cutfac.com: takes of a clip fanned out on a dark tile, the
 * chosen one in amber. Cards are listed back to front.
 */
const MARK = {
  tile: ["#332f2b", "#0e0d0c"],
  cards: [
    { name: "variant", x: 6.5, y: 4, fill: ["#f6f4f1", "#f6f4f1"], opacity: 0.38 },
    { name: "chosen", x: 10, y: 7, fill: ["#f4c022", "#e3a90f"], opacity: 1 },
    { name: "front", x: 13.5, y: 10, fill: ["#fffefb", "#e6e1d8"], opacity: 1 },
  ],
} as const;

function CutfacMark({ className }: { className?: string }) {
  // Gradient ids are document-wide, so each drawing gets its own.
  const id = useId();
  const fills = [{ name: "tile", fill: MARK.tile }, ...MARK.cards];

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <defs>
        {fills.map(({ name, fill: [top, bottom] }) => (
          <linearGradient key={name} id={`${id}-${name}`} x2="0" y2="1">
            <stop stopColor={top} />
            <stop offset="1" stopColor={bottom} />
          </linearGradient>
        ))}
      </defs>
      <rect width="32" height="32" rx="7" fill={`url(#${id}-tile)`} />
      {MARK.cards.map(({ name, x, y, opacity }) => (
        <rect
          key={name}
          x={x}
          y={y}
          width="12"
          height="18"
          rx="3.25"
          fill={`url(#${id}-${name})`}
          fillOpacity={opacity}
        />
      ))}
    </svg>
  );
}

/**
 * The workspace's name at the top of the sidebar. In the app it opens the workspaces in the app's
 * folder to switch to, a new one there by name, and any folder elsewhere.
 */
export function WorkspaceMenu({ ws }: { ws: WorkspaceInfo | undefined }) {
  const t = useMessages();
  const name = ws?.name ?? t.nav.appName;
  const [list, setList] = useState<LibraryWorkspaces["workspaces"]>([]);
  const [creating, setCreating] = useState(false);

  const content = (
    <>
      {/* Important, since the menu button sizes every svg in it as a small icon. */}
      <CutfacMark className="size-8!" />
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span title={ws?.root} className="truncate font-semibold">
          {name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{t.nav.appName}</span>
      </div>
    </>
  );

  if (!desktop) {
    return (
      <SidebarMenuButton
        size="lg"
        tooltip={name}
        render={
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the button's children
          <a href={href("board")} />
        }
      >
        {content}
      </SidebarMenuButton>
    );
  }

  const shell = desktop;

  // Read each time the menu opens, so a workspace made in Finder or elsewhere shows up.
  const load = () =>
    shell.workspaces().then(
      (found) => setList(found.workspaces),
      () => setList([]),
    );

  const switchTo = (workspace: string) =>
    shell.switchWorkspace(workspace).catch((cause: Error) => toast.error(cause.message));

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void load();
        }}
      >
        <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={name} />}>
          {content}
          <ChevronsUpDownIcon className="ml-auto" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="min-w-56">
          {list.length === 0 ? null : (
            <>
              <DropdownMenuGroup>
                {list.map((workspace) => (
                  <DropdownMenuItem
                    key={workspace.path}
                    title={workspace.path}
                    onClick={() => {
                      if (!workspace.current) void switchTo(workspace.name);
                    }}
                  >
                    {workspace.current ? <CheckIcon /> : <span aria-hidden className="size-4" />}
                    <span className="truncate">{workspace.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <PlusIcon />
            {t.workspaces.newWorkspace}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openWorkspace}>
            <FolderOpenIcon />
            {t.workspaces.openFolder}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** Asks only for a name; the workspace goes in the app's folder, and the board moves to it. */
function NewWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useMessages().workspaces;
  const nameId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();

    if (desktop === undefined || name.trim() === "") return;

    setBusy(true);
    setError(undefined);
    // On success the window loads the new workspace, so only a failure comes back here.
    desktop.newWorkspace(name).then(
      (failure) => {
        setBusy(false);

        if (failure === undefined) return;

        setError(
          Match.value(failure).pipe(
            Match.when({ kind: "taken" }, () => t.taken),
            Match.when({ kind: "invalid" }, () => t.invalidName),
            // An empty message: the app said why in a dialog of its own.
            Match.when({ kind: "failed" }, ({ message }) => message || undefined),
            Match.exhaustive,
          ),
        );
      },
      (cause: Error) => {
        setBusy(false);
        setError(cause.message);
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) {
          setName("");
          setError(undefined);
        }
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{t.newTitle}</DialogTitle>
            <DialogDescription>{t.newBody}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={nameId}>{t.nameLabel}</FieldLabel>
            <Input
              id={nameId}
              value={name}
              maxLength={64}
              placeholder={t.namePlaceholder}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {error === undefined ? null : <ErrorAlert message={error} />}
          <DialogFooter>
            <Button type="submit" disabled={busy || name.trim() === ""}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy ? t.creating : t.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
