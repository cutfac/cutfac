import { Match } from "effect";
import { type CSSProperties, useEffect } from "react";

import { AnnouncementDialog } from "@/components/announcement-dialog";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { DesktopLicense } from "@/components/desktop-license";
import { NewItemDialog } from "@/components/new-item-dialog";
import { ErrorAlert } from "@/components/page";
import { TitleBar } from "@/components/title-bar";
import { SidebarInset } from "@/components/ui/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar-provider";
import { cn } from "@/lib/utils";

import { api } from "./api.ts";
import { briefApi } from "./briefApi.ts";
import { desktop, insetTitleBar } from "./desktop.ts";
import { href, useHashRoute, useLive, usePlan, useSidebarOpen, useSidebarWidth } from "./hooks.ts";
import { useMessages } from "./i18n/index.ts";
import { LiveState } from "./lib/live.ts";
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
  const workspace = useLive("workspace", api.workspace);
  const ws = workspace.data;
  const brief = useLive("brief", briefApi.brief);
  const plan = usePlan();
  useConnectAgents();
  const editing = view === "item" && id ? id : undefined;
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen();
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth();

  // Opened with no page in mind, a workspace with no template yet starts on making one. Unknown
  // until both have loaded; a brief that can't be read doesn't hold that up.
  const startFirst =
    ws === undefined || LiveState.$is("Loading")(brief.state)
      ? undefined
      : needsStart(ws.formats.length, brief.data?.exists ?? true, startSkipped(ws.root));

  const landing =
    location.hash === "" && !LiveState.$is("Failed")(workspace.state) && startFirst !== false;

  // Opened with no page in mind, a new workspace starts on its first template. Once; after that
  // the user roams freely.
  useEffect(() => {
    if (location.hash === "" && startFirst) location.hash = href("start");
  }, [startFirst]);

  if (view === "start") return <Start ws={ws} brief={brief} />;

  // Nothing to show until it is clear which page opens, so the board doesn't flash first.
  if (landing) return <div className="h-dvh bg-background" />;

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      // SAFETY: CSSProperties has no index signature for custom properties; the value is a plain length.
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      // On macOS the title bar runs across the window above the sidebar and the content.
      className={cn("min-h-0", insetTitleBar ? "mt-10 h-[calc(100dvh-2.5rem)]" : "h-dvh")}
    >
      <AppSidebar
        ws={ws}
        plan={plan}
        view={view}
        id={id}
        width={sidebarWidth}
        onWidth={setSidebarWidth}
      />
      <SidebarInset className="min-h-0 min-w-0 [view-transition-name:page]">
        <TitleBar>
          {Match.value(workspace.state).pipe(
            Match.tag("Failed", ({ error }) => (
              <div className="shrink-0 px-6 pb-2">
                <ErrorAlert title={t.app.unreachable} message={error} />
              </div>
            )),
            Match.orElse(() => null),
          )}
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
      <NewItemDialog formats={ws?.formats} plan={plan} defaultAgent={ws?.config.agent.default} />
      <CommandPalette editing={editing} />
      {desktop ? <DesktopLicense desktop={desktop} /> : null}
      <AnnouncementDialog />
    </SidebarProvider>
  );
}

/**
 * In the app, connects every agent ready to run when none is connected yet, once: the user set one
 * up on the way to the workspace, so there is nothing left to ask. Runs from the board don't need
 * it, so nothing waits on it; connecting only lets the user's agent reach the workspace elsewhere.
 */
function useConnectAgents(): void {
  useEffect(() => {
    if (desktop === undefined) return;

    void api.agents().then(
      (statuses) => {
        if (statuses.some((status) => status.connected)) return;

        return Promise.allSettled(
          agentsToConnect(statuses).map((agent) => api.connectAgent(agent)),
        );
      },
      () => {
        // Setup shows what went wrong, when the user goes there.
      },
    );
  }, []);
}

function renderView(view: string, id: string | undefined) {
  if (view === "learn") return <Learn />;

  if (view === "templates") return <Templates selected={id} />;

  if (view === "setup") return <Setup />;

  return <Board />;
}
