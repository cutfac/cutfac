import {
  ArrowRightIcon,
  TargetIcon,
  ClapperboardIcon,
  LanguagesIcon,
  LayoutTemplateIcon,
  MessageSquareIcon,
  PlugZapIcon,
  PlusIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { FeedbackDialog } from "@/components/feedback-dialog";
import { ItemMenu } from "@/components/item-menu";
import { NewItemTrigger } from "@/components/new-item-dialog";
import { PlanCard } from "@/components/plan-card";
import { SidebarResizer } from "@/components/sidebar-resizer";
import { StatusDot } from "@/components/status-dot";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar-menu";
import { useSidebar } from "@/components/ui/sidebar-provider";
import { workDot, workText } from "@/components/work-state";
import { WorkspaceMenu } from "@/components/workspace-menu";

import { api, type Plan, type WorkspaceInfo } from "../api.ts";
import { desktop, insetTitleBar } from "../desktop.ts";
import { href, useLive, type Live } from "../hooks.ts";
import {
  isLocale,
  LOCALE_NAMES,
  LOCALES,
  setLocale,
  useLocale,
  useMessages,
} from "../i18n/index.ts";
import { APP_KEYS } from "../lib/app-commands.ts";
import { archiveItems, moveItems } from "../lib/items.ts";
import { failureSeen } from "../lib/render-seen.ts";
import { attention, inProgress } from "../lib/work.ts";

interface MainNavItem {
  view: "board" | "learn" | "templates";
  icon: LucideIcon;
}

export const MAIN_NAV: ReadonlyArray<MainNavItem> = [
  { view: "board", icon: ClapperboardIcon },
  { view: "learn", icon: TargetIcon },
  { view: "templates", icon: LayoutTemplateIcon },
];

/** How many videos the sidebar lists before pointing at the board. */
const MAX_VIDEOS = 8;

interface LinkRowProps {
  to: string;
  active: boolean;
  tooltip?: ReactNode;
  title?: string | undefined;
  /** How many videos wait for the user there, at the row's right edge; nothing when zero. */
  badge?: number | undefined;
  /** What waits for the user there, or goes on, as a dot at the row's right edge read out as this. */
  dot?: string | undefined;
  /** The dot's color; the sidebar's text color unless said. */
  dotTone?: string | undefined;
  /** What a right click on the row offers, as a context menu's content. */
  menu?: ReactNode;
  children: ReactNode;
}

/** One sidebar row that navigates; the narrow-screen sheet closes behind it. */
function LinkRow({
  to,
  active,
  tooltip,
  title,
  badge,
  dot,
  dotTone = "bg-sidebar-foreground",
  menu,
  children,
}: LinkRowProps) {
  const t = useMessages();
  const { setOpenMobile } = useSidebar();

  const row = (
    <>
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
        <SidebarMenuBadge aria-label={t.nav.waiting(badge)}>{badge}</SidebarMenuBadge>
      ) : null}
      {dot === undefined ? null : (
        // Beside the label, or by the icon's corner while the sidebar is folded to icons.
        <span
          className={`pointer-events-none absolute top-3.25 right-2.75 size-1.5 rounded-full ${dotTone} group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:right-0.5`}
        >
          <span className="sr-only">{dot}</span>
        </span>
      )}
    </>
  );

  if (menu === undefined) return <SidebarMenuItem>{row}</SidebarMenuItem>;

  return (
    <ContextMenu>
      {/* The menu button lights while the row's menu is open, as on hover. */}
      <ContextMenuTrigger render={<SidebarMenuItem />}>{row}</ContextMenuTrigger>
      {menu}
    </ContextMenu>
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
              <DropdownMenuRadioItem key={option} value={option} lang={option} closeOnClick>
                {LOCALE_NAMES[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

/** A collapsed row's name, and its shortcut where it has one. */
function withKeys(label: string, keys: string | undefined): ReactNode {
  if (keys === undefined) return label;

  return (
    <>
      {label} <Kbd>{keys}</Kbd>
    </>
  );
}

interface AppSidebarProps {
  ws: WorkspaceInfo | undefined;
  plan: Live<Plan>;
  view: string;
  /** The open item or template, from the second part of the route. */
  id: string | undefined;
  /** The sidebar's width in pixels, which its right edge drags. */
  width: number;
  onWidth: (width: number) => void;
}

export function AppSidebar({ ws, plan, view, id, width, onWidth }: AppSidebarProps) {
  const t = useMessages();
  const live = useLive("items", api.items);
  const items = live.data ?? [];
  const videos = inProgress(items, failureSeen).slice(0, MAX_VIDEOS);
  const editing = view === "item" && id ? id : undefined;
  const notice = attention(items, failureSeen);

  // The desktop app's Dock badge and notifications follow what waits for the user.
  useEffect(() => desktop?.setAttention(notice), [notice]);

  // An open video that is not listed leaves Board lit, as the board is where it lives.
  const boardActive =
    view === "board" || (editing !== undefined && !videos.some(({ item }) => item.id === editing));

  return (
    <Sidebar
      collapsible="icon"
      // The sidebar frames the content beside it, which sits in it as a card. On macOS it sits under
      // the title bar, on the window's sidebar material.
      variant="inset"
      {...(insetTitleBar && { className: "top-10 h-[calc(100svh-2.5rem)]" })}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <WorkspaceMenu ws={ws} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <NewItemTrigger
              render={
                <SidebarMenuButton tooltip={withKeys(t.nav.newVideo, APP_KEYS.newVideo)}>
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
                  tooltip={withKeys(t.nav[target], APP_KEYS[target])}
                  badge={target === "board" ? notice.waiting : undefined}
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
            <SidebarGroupLabel>{t.nav.inProgress}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {videos.map(({ item: video, work }) => {
                  const state = workText(work, t);

                  return (
                    <LinkRow
                      key={video.id}
                      to={href("item", video.id)}
                      active={video.id === editing}
                      title={t.nav.videoTitle(video.title, t.status[video.status], state)}
                      dot={state}
                      dotTone={workDot(work)}
                      menu={
                        <ItemMenu
                          items={[video]}
                          onMove={(moving, status) => moveItems(live, moving, status)}
                          onArchive={(archiving) => void archiveItems(archiving, t)}
                        />
                      }
                    >
                      <StatusDot status={video.status} />
                      <span className="sr-only">{t.status[video.status]}</span>
                      <span>{video.title}</span>
                    </LinkRow>
                  );
                })}
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
        <PlanCard plan={plan.data} />
        <SidebarMenu>
          <LinkRow to={href("setup")} active={view === "setup"} tooltip={t.nav.setup}>
            <PlugZapIcon />
            <span>{t.nav.setup}</span>
          </LinkRow>
          <LanguageMenu />
          <SidebarMenuItem>
            <FeedbackDialog
              trigger={
                <SidebarMenuButton tooltip={t.nav.sendFeedback}>
                  <MessageSquareIcon />
                  <span>{t.nav.sendFeedback}</span>
                </SidebarMenuButton>
              }
            />
          </SidebarMenuItem>
          {desktop?.openDevPanel ? (
            // Only in the dev build, so it isn't translated.
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Dev Panel" onClick={desktop.openDevPanel}>
                <WrenchIcon />
                <span>Dev Panel</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarResizer width={width} onWidth={onWidth} />
    </Sidebar>
  );
}
