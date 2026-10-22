import { useEffect, useState } from "react";

import { AnnouncementDialog } from "@/components/announcement-dialog";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { DesktopLicense } from "@/components/desktop-license";
import { NewItemDialog } from "@/components/new-item-dialog";
import { ErrorAlert } from "@/components/page";
import { TitleBar } from "@/components/title-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { api } from "./api.ts";
import { briefApi } from "./briefApi.ts";
import { desktop, insetTitleBar } from "./desktop.ts";
import { href, useHashRoute, useLive, usePlan, useSidebarOpen } from "./hooks.ts";
import { useMessages } from "./i18n/index.ts";
import { agentsToConnect, needsStart, startSkipped } from "./lib/onboarding.ts";
import { Board } from "./views/Board.tsx";
import { DevTools } from "./views/DevTools.tsx";
import { DragHelper } from "./views/DragHelper.tsx";
import { ItemView } from "./views/ItemView.tsx";
import { Learn } from "./views/Learn.tsx";
import { Setup } from "./views/Setup.tsx";
import { Start } from "./views/Start.tsx";
import { Templates } from "./views/Templates.tsx";
import { Welcome } from "./views/Welcome.tsx";

export function App() {
  const [view, id] = useHashRoute();
  const onboarding = desktop?.onboarding;

  // The app's first launch runs before there is a workspace, and so a server to talk to.
  if (onboarding !== undefined && view === "welcome") {
    return <Welcome onboarding={onboarding} step={id} />;
  }

  if (onboarding !== undefined && view === "drag-helper")
    return <DragHelper onboarding={onboarding} />;

  // The dev build's Dev Panel; the bridge has its tools in that window alone.
  if (desktop?.dev !== undefined && view === "dev") return <DevTools dev={desktop.dev} />;

  return <Shell view={view} id={id} />;
}

/** The board on a workspace: the sidebar and the page, or the first template while it has none. */
function Shell({ view, id }: { view: string; id: string | undefined }) {
  const t = useMessages();
  const { data: ws, error } = useLive("workspace", api.workspace);
  const brief = useLive("brief", briefApi.brief);
  const plan = usePlan();
  const needsSetup = useNeedsSetup();
  const editing = view === "item" && id ? id : undefined;
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen(editing !== undefined);

  // Opened with no page in mind, a workspace with no template yet starts on making one. Unknown
  // until both have loaded; a brief that can't be read doesn't hold that up.
  const startFirst =
    ws === undefined || (brief.data === undefined && brief.error === undefined)
      ? undefined
      : needsStart(ws.formats.length, brief.data?.exists ?? true, startSkipped(ws.root));

  const landing = location.hash === "" && error === undefined && startFirst !== false;

  // Opened with no page in mind, send the user to connect an agent if none is, since making the
  // first template needs one, and else to the first template. Once; after that they roam freely.
  useEffect(() => {
    if (location.hash !== "" || needsSetup === undefined) return;

    if (needsSetup) location.hash = href("setup");
    else if (startFirst) location.hash = href("start");
  }, [needsSetup, startFirst]);

  if (view === "start") return <Start id={id} ws={ws} brief={brief} />;

  // Nothing to show until it is clear which page opens, so the board doesn't flash first.
  if (landing) return <div className="h-dvh bg-background" />;

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      // On macOS the title bar runs across the window above the sidebar and the content.
      className={cn("min-h-0", insetTitleBar ? "mt-10 h-[calc(100dvh-2.5rem)]" : "h-dvh")}
    >
      <AppSidebar ws={ws} plan={plan} brief={brief} view={view} id={id} />
      <SidebarInset className="min-h-0 min-w-0">
        <TitleBar>
          {error ? (
            <div className="shrink-0 px-6 pb-2">
              <ErrorAlert title={t.app.unreachable} message={error} />
            </div>
          ) : null}
          {editing !== undefined ? (
            // Keyed by item so the selection, playback and chat start fresh for each one.
            <ItemView key={editing} id={editing} defaultAgent={ws?.config.agent.default} />
          ) : (
            // Keyed by view so each view opens scrolled to the top.
            <div key={view} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
              {renderView(view, id)}
            </div>
          )}
        </TitleBar>
      </SidebarInset>
      <NewItemDialog formats={ws?.formats} plan={plan} />
      <CommandPalette editing={editing} />
      {desktop ? <DesktopLicense desktop={desktop} /> : null}
      <AnnouncementDialog />
    </SidebarProvider>
  );
}

/**
 * Whether no agent is connected to the workspace, checked once. Undefined while it checks, and
 * false when it can't, since there is nothing then to point the user at. In the app, every agent
 * ready to run connects first: the user set one up on the way to the workspace, so there is
 * nothing left to ask.
 */
function useNeedsSetup(): boolean | undefined {
  const [needs, setNeeds] = useState<boolean>();

  useEffect(() => {
    let alive = true;

    const check = async () => {
      const statuses = await api.agents();

      const toConnect = statuses.some((status) => status.connected)
        ? []
        : agentsToConnect(statuses);

      if (desktop === undefined || toConnect.length === 0) {
        return !statuses.some((status) => status.connected);
      }

      await Promise.allSettled(toConnect.map((agent) => api.connectAgent(agent)));

      return !(await api.agents()).some((status) => status.connected);
    };

    check().then(
      (next) => {
        if (alive) setNeeds(next);
      },
      () => {
        if (alive) setNeeds(false);
      },
    );

    return () => {
      alive = false;
    };
  }, []);

  return needs;
}

function renderView(view: string, id: string | undefined) {
  if (view === "learn") return <Learn />;

  if (view === "templates") return <Templates selected={id} />;

  if (view === "setup") return <Setup />;

  return <Board />;
}
