import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { stripVTControlCharacters } from "node:util";

import { Option, Schema } from "effect";
import { app } from "electron";

import { AgentSetupJson, type AgentSetup } from "../src/core/agentReadiness.ts";
import type { AgentName } from "../src/core/schema.ts";
import type { AgentFix } from "../web/src/desktop.ts";
import { resolveServerEnv, runCli } from "./sidecarRuntime.ts";

/** A sign-in waits on the user's browser; one left that long is given up on. */
const FIX_TIMEOUT_MS = 10 * 60_000;

const decodeSetups = Schema.decodeUnknownOption(AgentSetupJson);

/**
 * What the last check named to fix each agent. A fix runs only a command the app's own check
 * found, never one the page sends.
 */
let fixes = new Map<AgentName, string>();

/** A fix already running, so a second press waits on it instead of starting another. */
const running = new Map<AgentName, Promise<AgentFix>>();

const children = new Set<ChildProcess>();

/** Every agent CLI as found on this computer now, from `cutfac agents --json`. */
export async function agentSetups(): Promise<ReadonlyArray<AgentSetup>> {
  const { stdout } = await runCli(["agents", "--json"]);
  const setups = Option.getOrUndefined(decodeSetups(stdout.trim()));

  if (setups === undefined) throw new Error("Could not check the agents on this computer");

  fixes = new Map(setups.flatMap((setup) => (setup.fix ? [[setup.agent, setup.fix]] : [])));

  return setups;
}

/** Runs the agent's fix in the user's shell environment, passing on each line it prints. */
export function fixAgent(agent: AgentName, onLine: (line: string) => void): Promise<AgentFix> {
  const command = fixes.get(agent);

  if (command === undefined) return Promise.reject(new Error(`Nothing to fix for ${agent}`));

  const current = running.get(agent);

  if (current) return current;

  const fixing = runFix(command, onLine).finally(() => running.delete(agent));

  running.set(agent, fixing);

  return fixing;
}

async function runFix(command: string, onLine: (line: string) => void): Promise<AgentFix> {
  const child = spawn("/bin/sh", ["-c", command], {
    cwd: app.getPath("home"),
    env: await resolveServerEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    // A group of its own, so stopping it stops the installer its shell runs too.
    detached: true,
  });

  const timer = setTimeout(() => stop(child), FIX_TIMEOUT_MS);

  children.add(child);

  // Installers redraw their progress with carriage returns, which end a line here too.
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      const text = stripVTControlCharacters(line).trim();

      if (text !== "") onLine(text);
    });
  }

  return new Promise((resolve) => {
    const settle = (ok: boolean) => {
      clearTimeout(timer);
      children.delete(child);
      resolve({ ok, command });
    };

    child.once("error", () => settle(false));
    child.once("close", (code) => settle(code === 0));
  });
}

/** Kills a fix with everything it started. */
function stop(child: ChildProcess): void {
  if (child.pid === undefined) return;

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // It has ended already.
  }
}

/** Stops every fix still running, as the app quits. */
export function stopFixes(): void {
  for (const child of children) stop(child);
}
