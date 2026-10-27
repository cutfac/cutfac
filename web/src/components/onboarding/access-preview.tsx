import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  HandGrabIcon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { useMessages } from "../../i18n/index.ts";

/** The app as the list shows it. */
interface App {
  icon: string;
  name: string;
}

/** The sidebar's rows above and below the open pane, drawn as bars of these widths. */
const SIDEBAR_ABOVE = ["w-3/5", "w-1/2"];

const SIDEBAR_BELOW = ["w-2/3", "w-1/2"];

/**
 * A small picture of what the button opens: System Settings on a permission's list, the
 * panel under it, and a pointer that takes the app from the panel into the list, on a loop. With
 * reduced motion it shows the app already in the list.
 */
export function AccessPreview({ app, list }: { app: App | undefined; list: string }) {
  const messages = useMessages().onboarding;
  const t = messages.access.preview;
  const hint = messages.dragHelper.hint;

  return (
    <div aria-hidden className="relative h-57 select-none">
      <div className="absolute inset-x-0 top-0 h-40 overflow-hidden rounded-xl bg-background shadow-md ring-1 ring-foreground/15">
        <Sidebar pane={t.pane} search={t.search} />
        <div className="absolute inset-y-0 right-0 left-1/3 flex flex-col px-3 pt-2.5">
          <div className="flex h-4 items-center gap-1 text-muted-foreground">
            <ChevronLeftIcon className="size-3" />
            <ChevronRightIcon className="size-3 opacity-40" />
            <span className="ml-1 text-xs font-semibold text-foreground">{list}</span>
          </div>
          <div className="mt-3 flex flex-col divide-y divide-foreground/8 rounded-lg bg-foreground/5 px-2">
            <Row />
            <Row />
            <Row app={app} className="animate-access-row motion-reduce:animate-none" />
          </div>
          <div className="mt-1.5 flex gap-0.5 text-muted-foreground">
            <PlusIcon className="size-3" />
            <MinusIcon className="size-3 opacity-40" />
          </div>
        </div>
      </div>
      <div className="absolute top-42 right-0 bottom-0 left-1/3 rounded-xl bg-background p-1 shadow-md ring-1 ring-foreground/15">
        <DragCard app={app} hint={hint} />
      </div>
      {/* The app on its way up, as macOS drags it: its icon under the pointer that comes in, takes it
          and lets it go. Laid out as the card is, so it starts on the card's icon. */}
      <div className="absolute top-42 right-0 bottom-0 left-1/3 p-1 motion-reduce:hidden">
        <div className="flex h-full items-center px-2">
          <div className="relative size-6 animate-access-carry">
            {app === undefined ? null : (
              <img src={app.icon} alt="" className="size-6 animate-access-card drop-shadow-md" />
            )}
            <div className="absolute top-3 left-3 size-6 animate-access-pointer">
              <MousePointer2Icon className="absolute inset-0 size-6 animate-access-arrow fill-foreground text-background" />
              <HandGrabIcon className="absolute inset-0 size-6 animate-access-grab fill-foreground text-background" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** System Settings' sidebar: the window's buttons, the search field, and Privacy & Security open. */
function Sidebar({ pane, search }: { pane: string; search: string }) {
  return (
    <div className="absolute inset-y-1.5 left-1.5 flex w-[calc(33.333%-0.75rem)] flex-col gap-1.5 rounded-lg bg-foreground/6 p-2">
      <div className="flex gap-1">
        <span className="size-2 rounded-full bg-mac-close" />
        <span className="size-2 rounded-full bg-mac-minimize" />
        <span className="size-2 rounded-full bg-mac-zoom" />
      </div>
      <div className="mt-1 flex h-4 items-center gap-1 rounded-full bg-foreground/8 px-1.5 text-xs text-muted-foreground">
        <SearchIcon className="size-2.5 shrink-0" />
        <span className="truncate">{search}</span>
      </div>
      {SIDEBAR_ABOVE.map((width) => (
        <SidebarRow key={width} width={width} />
      ))}
      <div className="-mx-1 flex h-5 items-center gap-1.5 rounded-md bg-mac-accent/80 px-1">
        <span className="size-3 shrink-0 rounded-xs bg-mac-accent ring-1 ring-foreground/30" />
        <span className="truncate text-xs text-foreground">{pane}</span>
      </div>
      {SIDEBAR_BELOW.map((width) => (
        <SidebarRow key={width} width={width} />
      ))}
    </div>
  );
}

function SidebarRow({ width }: { width: string }) {
  return (
    <div className="flex h-3 items-center gap-1.5">
      <span className="size-3 shrink-0 rounded-xs bg-foreground/15" />
      <span className={cn("h-1.5 rounded-full bg-foreground/12", width)} />
    </div>
  );
}

/** A row of the list: an app and its switch. The app's own row turns its switch on as it lands. */
function Row({ app, className }: { app?: App | undefined; className?: string }) {
  return (
    <div className={cn("flex h-6 items-center gap-2", className)}>
      {app === undefined ? (
        <>
          <span className="size-4 rounded-sm bg-foreground/15" />
          <span className="h-1.5 w-16 rounded-full bg-foreground/12" />
        </>
      ) : (
        <>
          <img src={app.icon} alt="" className="size-4" />
          <span className="text-xs">{app.name}</span>
        </>
      )}
      <span className="relative ml-auto h-3.5 w-6 rounded-full bg-foreground/15">
        <span
          className={cn(
            "absolute inset-0 rounded-full bg-mac-accent",
            app === undefined ? null : "animate-access-switch motion-reduce:animate-none",
          )}
        />
        <span
          className={cn(
            "absolute top-0.5 right-0.5 size-2.5 rounded-full bg-foreground shadow-sm",
            app === undefined ? null : "animate-access-knob motion-reduce:animate-none",
          )}
        />
      </span>
    </div>
  );
}

/** The panel's card, as the real panel draws it: the app to drag, where it goes, and a gold glow. */
function DragCard({ app, hint }: { app: App | undefined; hint: string }) {
  return (
    <div className="relative flex h-full animate-access-glow items-center gap-2 overflow-hidden rounded-lg bg-foreground/6 px-2 motion-reduce:animate-none">
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-access-shine bg-linear-to-r from-transparent via-foreground/12 to-transparent motion-reduce:hidden" />
      {app === undefined ? (
        <span className="size-6 shrink-0 rounded-md bg-foreground/15" />
      ) : (
        <img src={app.icon} alt="" className="size-6 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-semibold">{app?.name}</span>
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      </div>
      <ArrowUpIcon className="size-3.5 shrink-0 animate-bounce text-brand motion-reduce:animate-none" />
      <XIcon className="size-3 shrink-0 text-muted-foreground" />
    </div>
  );
}
