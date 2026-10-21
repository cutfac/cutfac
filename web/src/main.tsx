import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { App } from "./App.tsx";
import { installAppCommands } from "./lib/app-commands.ts";
import { installDropGuard } from "./lib/drop-guard.ts";
import { installEditCommands } from "./lib/edit-commands.ts";

import "./styles.css";

installEditCommands();

installAppCommands();

installDropGuard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
    <Toaster />
  </StrictMode>,
);
