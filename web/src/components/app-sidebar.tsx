import {
  ArrowRightIcon,
  ChevronsUpDownIcon,
  ClapperboardIcon,
  FactoryIcon,
  FolderOpenIcon,
  LanguagesIcon,
  LayoutTemplateIcon,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import {
  isLocale,
  LOCALE_NAMES,
  LOCALES,
  setLocale,
  useLocale,
  useMessages,
} from "../i18n/index.ts";
import { feedbackUrl } from "../lib/feedback.ts";

interface MainNavItem {
  view: "board" | "references" | "templates" | "product";
  icon: LucideIcon;
}

const MAIN_NAV: ReadonlyArray<MainNavItem> = [
  { view: "board", icon: ClapperboardIcon },
  { view: "references", icon: LibraryIcon },
  { view: "templates", icon: LayoutTemplateIcon },
  { view: "product", icon: PackageIcon },
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
  const t = useMessages();
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
        <SidebarMenuBadge aria-label={t.nav.openFeedback(badge)}>{badge}</SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}

function WorkspaceMenu({ ws }: { ws: WorkspaceInfo | undefined }) {
  const t = useMessages();
  const name = ws?.name ?? t.nav.appName;

  const content = (
    <>
      <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
        <FactoryIcon className="size-4" />
      </div>
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={name} />}>
        {content}
        <ChevronsUpDownIcon className="ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="min-w-56">
        <DropdownMenuItem onClick={openWorkspace}>
          <FolderOpenIcon />
          {t.nav.openWorkspace}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageMenu() {
  const t = useMessages();
  const locale = useLocale();

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuButton tooltip={t.language.label} />}>
          <LanguagesIcon />
          <span>
            <span className="sr-only">{t.language.label}: </span>
            {LOCALE_NAMES[locale]}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-40">
          <DropdownMenuRadioGroup
            value={locale}
            onValueChange={(value) => {
              if (isLocale(value)) setLocale(value);
            }}
          >
            {LOCALES.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} lang={option}>
                {LOCALE_NAMES[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

interface AppSidebarProps {
  ws: WorkspaceInfo | undefined;
  view: string;
  /** The open item or reference, from the second part of the route. */
  id: string | undefined;
}

export function AppSidebar({ ws, view, id }: AppSidebarProps) {
  const t = useMessages();
  const locale = useLocale();
  const { data: items } = useLive("items", api.items);
  const videos = sidebarVideos(items ?? []);
  const editing = view === "item" && id ? id : undefined;

  // An open video that is not listed leaves Board lit, as the board is where it lives.
  const boardActive =
    view === "board" || (editing !== undefined && !videos.some((v) => v.id === editing));

  // Undefined unless the build names a feedback form, so forks don't send feedback to ours.
  const feedbackLink = feedbackUrl(import.meta.env.VITE_FEEDBACK_FORM_ID, {
    version: import.meta.env.APP_VERSION,
    locale,
    platform: desktop?.platform ?? "web",
  });

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
                <SidebarMenuButton tooltip={t.nav.newVideo}>
                  <PlusIcon />
                  <span>{t.nav.newVideo}</span>
                </SidebarMenuButton>
              }
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label={t.nav.main}>
              {MAIN_NAV.map(({ view: target, icon: Icon }) => (
                <LinkRow
                  key={target}
                  to={href(target)}
                  active={target === "board" ? boardActive : view === target}
                  tooltip={t.nav[target]}
                  badge={target === "board" ? ws?.openFeedback : undefined}
                >
                  <Icon />
                  <span>{t.nav[target]}</span>
                </LinkRow>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {videos.length > 0 ? (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>{t.nav.videos}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {videos.map((video) => (
                  <LinkRow
                    key={video.id}
                    to={href("item", video.id)}
                    active={video.id === editing}
                    title={t.nav.videoTitle(
                      video.title,
                      t.status[video.status],
                      video.openFeedback,
                    )}
                  >
                    <StatusDot status={video.status} />
                    <span className="sr-only">{t.status[video.status]}</span>
                    <span>{video.title}</span>
                  </LinkRow>
                ))}
                <LinkRow to={href("board")} active={false}>
                  <ArrowRightIcon />
                  <span>{t.nav.allVideos}</span>
                </LinkRow>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <LinkRow to={href("setup")} active={view === "setup"} tooltip={t.nav.setup}>
            <PlugZapIcon />
            <span>{t.nav.setup}</span>
          </LinkRow>
          <LanguageMenu />
          {feedbackLink === undefined ? null : (
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip={t.nav.sendFeedback}
                // The desktop app hands new-window links to the default browser.
                render={
                  // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the button's children
                  <a href={feedbackLink} target="_blank" rel="noopener noreferrer" />
                }
              >
                <MessageSquareIcon />
                <span>{t.nav.sendFeedback}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
        <SidebarTrigger
          title={t.nav.toggle}
          className="self-end group-data-[collapsible=icon]:self-center"
        />
      </SidebarFooter>
    </Sidebar>
  );
}
