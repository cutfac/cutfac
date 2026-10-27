import {
  ArrowRightIcon,
  TargetIcon,
  ChevronsUpDownIcon,
  ClapperboardIcon,
  FolderOpenIcon,
  LanguagesIcon,
  LayoutTemplateIcon,
  MessageSquareIcon,
  PlugZapIcon,
  PlusIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import { toast } from "sonner";

import { FeedbackDialog } from "@/components/feedback-dialog";
import { NewItemTrigger } from "@/components/new-item-dialog";
import { PlanCard } from "@/components/plan-card";
import { SidebarResizer } from "@/components/sidebar-resizer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
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
  useSidebar,
} from "@/components/ui/sidebar";
import { workDot, workText } from "@/components/work-state";

import { api, type Plan, type Status, type WorkspaceInfo } from "../api.ts";
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

/** Fill and stroke for each status. The board's one color, gold, is kept for review. */
function statusDot(status: Status): string {
  switch (status) {
    case "drafting":
      return "fill-muted-foreground";
    case "review":
      return "fill-selection";
    case "done":
      return "fill-primary";
    case "archived":
      return "fill-none stroke-muted-foreground/50";
  }
}

/** An svg so the menu button spaces it exactly like the nav icons. */
export function StatusDot({ status }: { status: Status }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="4" strokeWidth="1.5" className={statusDot(status)} />
    </svg>
  );
}

export function openWorkspace() {
  // The desktop shell reloads the window itself once the new workspace is serving.
  desktop?.openWorkspace().catch((cause: Error) => toast.error(cause.message));
}

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
  children,
}: LinkRowProps) {
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
    </SidebarMenuItem>
  );
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

function WorkspaceMenu({ ws }: { ws: WorkspaceInfo | undefined }) {
  const t = useMessages();
  const name = ws?.name ?? t.nav.appName;

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
  const items = useLive("items", api.items).data ?? [];
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
