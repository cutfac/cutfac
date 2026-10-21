import { useEffect } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { DesktopLicense } from "@/components/desktop-license";
import { ErrorAlert } from "@/components/page";
import { TitleBarStrip } from "@/components/title-bar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

import { api } from "./api.ts";
import { desktop } from "./desktop.ts";
import { href, useAgentStatuses, useHashRoute, useLive, useSidebarOpen } from "./hooks.ts";
import { useMessages } from "./i18n/index.ts";
import { Board } from "./views/Board.tsx";
import { ItemView } from "./views/ItemView.tsx";
import { Learn } from "./views/Learn.tsx";
import { Setup } from "./views/Setup.tsx";
import { Templates } from "./views/Templates.tsx";

export function App() {
  const t = useMessages();
  const [view, id] = useHashRoute();
  const { data: ws, error } = useLive("workspace", api.workspace);
  const agents = useAgentStatuses();
  const needsSetup = agents !== undefined && !agents.some((agent) => agent.connected);
  const editing = view === "item" && id ? id : undefined;
  const [sidebarOpen, setSidebarOpen] = useSidebarOpen(editing !== undefined);

  // Without a connected agent, send the user to connect one once; after that they may roam freely.
  useEffect(() => {
    if (needsSetup && !location.hash) location.hash = href("setup");
  }, [needsSetup]);

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} className="h-dvh min-h-0">
      <AppSidebar ws={ws} view={view} id={id} />
      <SidebarInset className="min-h-0 min-w-0">
        <TitleBarStrip />
        {/* Below the tablet breakpoint the sidebar is a sheet, so its trigger moves up here. */}
        <div className="flex h-12 shrink-0 items-center border-b px-2 md:hidden">
          <SidebarTrigger />
        </div>
        {error ? (
          <div className="shrink-0 px-6 pt-4">
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
      </SidebarInset>
      {desktop ? <DesktopLicense desktop={desktop} /> : null}
    </SidebarProvider>
  );
}

function renderView(view: string, id: string | undefined) {
  if (view === "learn") return <Learn />;

  if (view === "templates") return <Templates selected={id} />;

  if (view === "setup") return <Setup />;

  return <Board />;
}
