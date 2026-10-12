import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ChevronsUpDownIcon,
  ClapperboardIcon,
  FactoryIcon,
  FolderOpenIcon,
  LibraryIcon,
  MessageSquareIcon,
  PackageIcon,
  PlugZapIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { NewItemDialog } from "@/components/new-item-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

import { api, type ItemSummary, type Status, type WorkspaceInfo } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href, useLive } from "../hooks.ts";
import { feedbackUrl } from "../lib/feedback.ts";

/** Every piece of sidebar copy lives here, so translating the app means editing one place. */
export const NAV_LABELS = {
  appName: "Content Factory",
  openWorkspace: "Open workspace…",
  newVideo: "New video",
  board: "Board",
  references: "References",
  calendar: "Calendar",
  product: "Product",
  setup: "Setup",
  sendFeedback: "Send feedback",
  videos: "Videos",
  allVideos: "All videos",
  toggle: "Toggle sidebar",
  openFeedback: (count: number) => `${count} open feedback`,
  videoTitle: (item: ItemSummary) =>
    item.openFeedback > 0
      ? `${item.title} (${item.status}, ${item.openFeedback} open feedback)`
      : `${item.title} (${item.status})`,
} as const;

/** Undefined unless the build names a feedback form, so forks don't send feedback to ours. */
const FEEDBACK_URL = feedbackUrl(import.meta.env.VITE_FEEDBACK_FORM_ID, {
  version: import.meta.env.APP_VERSION,
  locale: navigator.language,
  platform: desktop?.platform ?? "web",
});

interface MainNavItem {
  view: string;
  label: string;
  icon: LucideIcon;
}

const MAIN_NAV: ReadonlyArray<MainNavItem> = [
  { view: "board", label: NAV_LABELS.board, icon: ClapperboardIcon },
  { view: "references", label: NAV_LABELS.references, icon: LibraryIcon },
  { view: "calendar", label: NAV_LABELS.calendar, icon: CalendarDaysIcon },
  { view: "product", label: NAV_LABELS.product, icon: PackageIcon },
];

/** How many videos the sidebar lists before pointing at the board. */
const MAX_VIDEOS = 8;

/** Finished work never asks for attention, so it stays on the board. */
const isFinished = (item: ItemSummary) => item.status === "published" || item.status === "archived";

/** A video waits on the user when it carries open feedback or sits in review. */
const needsAttention = (item: ItemSummary) => item.openFeedback > 0 || item.status === "review";

/** Videos that need attention first, then the most recently touched. */
function sidebarVideos(items: ReadonlyArray<ItemSummary>): ItemSummary[] {
  return items
    .filter((item) => !isFinished(item))
    .toSorted(
      (a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || b.updatedAt - a.updatedAt,
    )
    .slice(0, MAX_VIDEOS);
}

/** Fill and stroke for each status. The theme has one color, amber, and it is kept for review. */
function statusDot(status: Status): string {
  switch (status) {
    case "idea":
      return "fill-none stroke-muted-foreground";
    case "drafting":
      return "fill-muted-foreground";
    case "review":
      return "fill-selection";
    case "approved":
      return "fill-primary/60";
    case "scheduled":
    case "published":
      return "fill-primary";
    case "archived":
      return "fill-none stroke-muted-foreground/50";
  }
}

/** An svg so the menu button spaces it exactly like the nav icons. */
function StatusDot({ status }: { status: Status }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="4" strokeWidth="1.5" className={statusDot(status)} />
    </svg>
  );
}

function openWorkspace() {
  // The desktop shell reloads the window itself once the new workspace is serving.
  desktop?.openWorkspace().catch((cause: Error) => toast.error(cause.message));
}

interface LinkRowProps {
  to: string;
  active: boolean;
  tooltip?: string | undefined;
  title?: string | undefined;
  /** Open feedback to show at the row's right edge; nothing when zero or missing. */
  badge?: number | undefined;
  children: ReactNode;
}

/** One sidebar row that navigates; the narrow-screen sheet closes behind it. */
function LinkRow({ to, active, tooltip, title, badge, children }: LinkRowProps) {
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        tooltip={tooltip}
        render={
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the button's children
          <a
            href={to}
            title={title}
            aria-current={active ? "page" : undefined}
            onClick={() => setOpenMobile(false)}
          />
        }
      >
        {children}
      </SidebarMenuButton>
      {badge ? (
        <SidebarMenuBadge aria-label={NAV_LABELS.openFeedback(badge)}>{badge}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function WorkspaceMenu({ ws }: { ws: WorkspaceInfo | undefined }) {
  const name = ws?.name ?? NAV_LABELS.appName;

  const content = (
    <>
      <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
        <FactoryIcon className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span title={ws?.root} className="truncate font-semibold">
          {name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{NAV_LABELS.appName}</span>
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={name} />}>
        {content}
        <ChevronsUpDownIcon className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="min-w-56">
        <DropdownMenuItem onClick={openWorkspace}>
          <FolderOpenIcon />
          {NAV_LABELS.openWorkspace}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AppSidebarProps {
  ws: WorkspaceInfo | undefined;
  view: string;
  /** The open item or reference, from the second part of the route. */
  id: string | undefined;
}

export function AppSidebar({ ws, view, id }: AppSidebarProps) {
  const { data: items } = useLive("items", api.items);
  const videos = sidebarVideos(items ?? []);
  const editing = view === "item" && id ? id : undefined;

  // An open video that is not listed leaves Board lit, as the board is where it lives.
  const boardActive =
    view === "board" || (editing !== undefined && !videos.some((v) => v.id === editing));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceMenu ws={ws} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <NewItemDialog
              formats={ws?.formats}
              trigger={
                <SidebarMenuButton tooltip={NAV_LABELS.newVideo}>
                  <PlusIcon />
                  <span>{NAV_LABELS.newVideo}</span>
                </SidebarMenuButton>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Main">
              {MAIN_NAV.map(({ view: target, label, icon: Icon }) => (
                <LinkRow
                  key={target}
                  to={href(target)}
                  active={target === "board" ? boardActive : view === target}
                  tooltip={label}
                  badge={target === "board" ? ws?.openFeedback : undefined}
                >
                  <Icon />
                  <span>{label}</span>
                </LinkRow>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {videos.length > 0 ? (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>{NAV_LABELS.videos}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {videos.map((video) => (
                  <LinkRow
                    key={video.id}
                    to={href("item", video.id)}
                    active={video.id === editing}
                    title={NAV_LABELS.videoTitle(video)}
                  >
                    <StatusDot status={video.status} />
                    <span className="sr-only">{video.status}</span>
                    <span>{video.title}</span>
                  </LinkRow>
                ))}
                <LinkRow to={href("board")} active={false}>
                  <ArrowRightIcon />
                  <span>{NAV_LABELS.allVideos}</span>
                </LinkRow>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <LinkRow to={href("setup")} active={view === "setup"} tooltip={NAV_LABELS.setup}>
            <PlugZapIcon />
            <span>{NAV_LABELS.setup}</span>
          </LinkRow>
          {FEEDBACK_URL === undefined ? null : (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={NAV_LABELS.sendFeedback}
                // The desktop app hands new-window links to the default browser.
                render={
                  // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the button's children
                  <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" />
                }
              >
                <MessageSquareIcon />
                <span>{NAV_LABELS.sendFeedback}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
        <SidebarTrigger
          title={NAV_LABELS.toggle}
          className="self-end group-data-[collapsible=icon]:self-center"
        />
      </SidebarFooter>
    </Sidebar>
  );
}
