import { ArchiveIcon, FolderOpenIcon, PanelLeftIcon, PlugZapIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { MAIN_NAV } from "@/components/app-sidebar";
import { openNewItem } from "@/components/new-item-dialog";
import { StatusDot } from "@/components/status-dot";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useSidebar } from "@/components/ui/sidebar";
import { openWorkspace } from "@/components/workspace-menu";

import { api } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { APP_KEYS, onAppCommand, type AppCommand } from "../lib/app-commands.ts";
import { MOD_KEY } from "../lib/edit-commands.ts";
import { archiveItems } from "../lib/items.ts";

function go(view: string, id?: string) {
  location.hash = href(view, id);
}

function Keys({ command }: { command: AppCommand }) {
  const keys = APP_KEYS[command];

  return keys === undefined ? null : <CommandShortcut>{keys}</CommandShortcut>;
}

interface PaletteCommandsProps {
  /** The open video, which the palette can act on. */
  editing: string | undefined;
  /** Close the palette, before what was chosen runs. */
  onChoose: () => void;
}

/** What the palette lists; mounted only while it is open, so the videos are fresh each time. */
function PaletteCommands({ editing, onChoose }: PaletteCommandsProps) {
  const t = useMessages();
  const { toggleSidebar } = useSidebar();
  const { data: items } = useLive("items", api.items);
  const current = items?.find((item) => item.id === editing);
  const videos = items?.toSorted((a, b) => b.updatedAt - a.updatedAt) ?? [];

  const choose = (action: () => void) => () => {
    onChoose();
    action();
  };

  return (
    <>
      <CommandInput placeholder={t.palette.placeholder} />
      <CommandList>
        <CommandEmpty>{t.palette.empty}</CommandEmpty>
        <CommandGroup heading={t.palette.actions}>
          <CommandItem onSelect={choose(openNewItem)}>
            <PlusIcon />
            {t.nav.newVideo}
            <Keys command="newVideo" />
          </CommandItem>
          <CommandItem onSelect={choose(toggleSidebar)}>
            <PanelLeftIcon />
            {t.nav.toggle}
            <Keys command="toggleSidebar" />
          </CommandItem>
          {desktop ? (
            <CommandItem onSelect={choose(openWorkspace)}>
              <FolderOpenIcon />
              {t.nav.openWorkspace}
              <CommandShortcut>{MOD_KEY}O</CommandShortcut>
            </CommandItem>
          ) : null}
        </CommandGroup>
        {/* After the actions, so ⌘K then Enter never archives. */}
        {current !== undefined && current.status !== "archived" ? (
          <CommandGroup heading={t.palette.thisVideo}>
            <CommandItem onSelect={choose(() => void archiveItems([current], t))}>
              <ArchiveIcon />
              {t.itemActions.archive}
            </CommandItem>
          </CommandGroup>
        ) : null}
        <CommandGroup heading={t.palette.goTo}>
          {MAIN_NAV.map(({ view, icon: Icon }) => (
            <CommandItem key={view} onSelect={choose(() => go(view))}>
              <Icon />
              {t.nav[view]}
              <Keys command={view} />
            </CommandItem>
          ))}
          <CommandItem onSelect={choose(() => go("setup"))}>
            <PlugZapIcon />
            {t.nav.setup}
          </CommandItem>
        </CommandGroup>
        {videos.length > 0 ? (
          <CommandGroup heading={t.nav.videos}>
            {videos.map((item) => (
              <CommandItem
                key={item.id}
                // By id, as titles can repeat; the search still matches the title.
                value={item.id}
                keywords={[item.title]}
                onSelect={choose(() => go("item", item.id))}
              >
                <StatusDot status={item.status} />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="text-xs text-muted-foreground">{t.status[item.status]}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </>
  );
}

/**
 * Find a video, a page or a command, with ⌘K. Also carries out the app commands that come from
 * the keyboard or the app menu, as they are the same commands.
 */
export function CommandPalette({ editing }: { editing: string | undefined }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const { toggleSidebar } = useSidebar();

  const run = useEffectEvent((command: AppCommand) => {
    if (command === "palette") setOpen((was) => !was);
    else if (command === "newVideo") openNewItem();
    else if (command === "toggleSidebar") toggleSidebar();
    else go(command);
  });

  useEffect(() => onAppCommand((command) => run(command)), []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t.palette.title}
      description={t.palette.description}
    >
      <Command>
        <PaletteCommands editing={editing} onChoose={() => setOpen(false)} />
      </Command>
    </CommandDialog>
  );
}
