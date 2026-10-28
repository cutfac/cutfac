#!/usr/bin/env bun
// Each command handler is an entry point: the workspace layer depends on the parsed --workspace.
// @effect-diagnostics strictEffectProvide:off
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Cause, Console, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import { AgentSetupJson } from "./core/agentReadiness.ts";
import {
  type CliEntry,
  SERVER_NAME,
  codexServerName,
  connectAgent,
  mcpLaunch,
} from "./core/agents.ts";
import { agentSetup } from "./core/agentSetup.ts";
import { COMPILED } from "./core/build.ts";
import { describeError } from "./core/errors.ts";
import { learn, learnInputOf } from "./core/learn.ts";
import { logDir, logToFile } from "./core/logFile.ts";
import { syncSkill } from "./core/skill.ts";
import { Workspace } from "./core/workspace.ts";
import { CONFIG_FILE, initWorkspace } from "./core/workspaceRoot.ts";
import { trustCreated } from "./core/workspaceTrust.ts";
import { errorReports } from "./errorReports.ts";
import { MCP_VERSION, mcpLayer } from "./mcp/server.ts";
import { appData } from "./plan.ts";
import { serverLayer } from "./server/app.ts";

const DEFAULT_PORT = 4317;

const DEFAULT_HOST = "127.0.0.1";

/** The compiled binary starts itself; from source, agents start `bun src/cli.ts`. */
const CLI: CliEntry = COMPILED
  ? { command: process.execPath, args: [] }
  : { command: "bun", args: [import.meta.path] };

const cliLine = [CLI.command, ...CLI.args].join(" ");

const tomlString = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const workspaceFlag = Flag.String("workspace").pipe(
  Flag.withDescription("Workspace folder, or any folder inside it"),
  Flag.withDefault("."),
);

/** The web build next to the sources, when there is one. The packaged app passes --web-dir. */
const defaultWebDir = Effect.fn("cli.defaultWebDir")(function* () {
  if (COMPILED) return Option.none<string>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(import.meta.dir, "..", "dist", "web");

  const built = yield* fs
    .exists(path.join(dir, "index.html"))
    .pipe(Effect.orElseSucceed(() => false));

  return built ? Option.some(dir) : Option.none<string>();
});

const connectAgents = Effect.fn("cli.connectAgents")(function* () {
  const ws = yield* Workspace;
  const launch = mcpLaunch(CLI, ws.root);
  yield* Console.log("\nConnecting agents:");

  for (const agent of ["claude", "codex"] as const) {
    const connection = yield* connectAgent(agent, launch);
    yield* Console.log(`  ${connection.ok ? "✓" : "–"} ${agent.padEnd(7)} ${connection.detail}`);
  }
});

const printAgentSetup = Effect.fn("cli.printAgentSetup")(function* () {
  const ws = yield* Workspace;
  const launch = mcpLaunch(CLI, ws.root);
  const args = launch.args.map(tomlString).join(", ");

  yield* Console.log(`
Connect your agent (run inside ${ws.root}):

  Claude Code:
    claude mcp add --scope project ${SERVER_NAME} -- ${[launch.command, ...launch.args].join(" ")}

  Codex (~/.codex/config.toml):
    [mcp_servers.${codexServerName(ws.config.name)}]
    command = ${tomlString(launch.command)}
    args = [${args}]

Then open the board:  ${cliLine} serve --workspace ${ws.root}
`);
});

const SKILL_REPORT = {
  missing: (path: string) => `Installed skill → ${path}`,
  outdated: (path: string) => `Updated skill → ${path}`,
  edited: (path: string) => `Kept your edited skill → ${path} (your agent will offer the new one)`,
  current: () => undefined,
};

/** Bring the agent skill up to date for Claude Code and Codex-style agents, and say what changed. */
const syncSkillCopies = Effect.fn("cli.syncSkillCopies")(function* () {
  for (const { path, state } of yield* syncSkill()) {
    const line = SKILL_REPORT[state](path);

    if (line !== undefined) yield* Console.log(line);
  }
});

/** Everything a workspace needs besides cutfac.yaml: its folders and the skill. */
const scaffold = Effect.fn("cli.scaffold")(function* () {
  const ws = yield* Workspace;
  const { paths } = ws.config;
  yield* Effect.forEach([paths.formats, paths.items], ws.mkdir, { discard: true });
  yield* syncSkillCopies();
});

const init = Command.make(
  "init",
  {
    dir: Argument.String("dir").pipe(
      Argument.withDescription("Folder to make into a workspace"),
      Argument.withDefault("."),
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Workspace name (default: the folder name)"),
      Flag.optional,
    ),
    items: Flag.String("items").pipe(
      Flag.withDescription("Where content items live, relative to the workspace"),
      Flag.optional,
    ),
    connect: Flag.Boolean("connect").pipe(
      Flag.withDescription("Connect Claude Code and Codex; --no-connect prints the setup instead"),
      Flag.withDefault(true),
    ),
  },
  Effect.fn("cli.init")(function* ({ dir, name, items, connect }) {
    const path = yield* Path.Path;
    const root = path.resolve(dir);

    const created = yield* initWorkspace(root, {
      name: Option.getOrElse(name, () => path.basename(root)),
      paths: Option.match(items, { onNone: () => ({}), onSome: (folder) => ({ items: folder }) }),
    });

    yield* Console.log(
      created ? `Created ${path.join(root, CONFIG_FILE)}` : `${root} is already a workspace`,
    );

    yield* Effect.gen(function* () {
      // A workspace that works without the record still beats none: Claude asks on the board.
      if (created)
        yield* trustCreated().pipe(Effect.catch((error) => Console.error(error.message)));
      yield* scaffold();
      // Agents come first: everything after this is done through them.
      yield* connect ? connectAgents() : printAgentSetup();

      if (connect) yield* Console.log(`\nOpen the board:  ${cliLine} serve --workspace ${root}`);
    }).pipe(Effect.provide([appData, Workspace.layer(root)]));
  }),
).pipe(Command.withDescription("Create a workspace and connect your agents"));

/**
 * The desktop app's log for this process, `server` or `mcp`, and its error reports when the
 * person allows them; neither for the open-source CLI.
 */
const processLog = (name: string) =>
  logToFile(name).pipe(
    Layer.provide(errorReports(name).pipe(Layer.provide(appData))),
    Layer.provideMerge(logDir),
  );

const serve = Command.make(
  "serve",
  {
    workspace: workspaceFlag,
    port: Flag.Int("port").pipe(
      Flag.withDescription("Port to listen on"),
      Flag.withDefault(DEFAULT_PORT),
    ),
    host: Flag.String("host").pipe(
      Flag.withDescription("Interface to listen on"),
      Flag.withDefault(DEFAULT_HOST),
    ),
    webDir: Flag.String("web-dir").pipe(
      Flag.withDescription("Built web board to serve (default: dist/web)"),
      Flag.optional,
    ),
  },
  Effect.fn("cli.serve")(function* ({ workspace, port, host, webDir }) {
    const path = yield* Path.Path;

    const dir = Option.isSome(webDir)
      ? Option.some(path.resolve(webDir.value))
      : yield* defaultWebDir();

    const server = serverLayer({
      port,
      hostname: host,
      cli: CLI,
      webDir: Option.getOrUndefined(dir),
    });

    return yield* Effect.gen(function* () {
      const ws = yield* Workspace;
      yield* Layer.build(server);
      // Serving is what matters here; a skill that cannot be written is for the agent to sort out.
      yield* syncSkillCopies().pipe(
        Effect.catchTag("WorkspaceError", (error) => Console.error(error.message)),
      );

      const note = Option.isSome(dir)
        ? ""
        : "  (API only — run `bun run build` or `bun run dev:web`)";

      yield* Console.log(`Cutfac · ${ws.config.name}`);
      yield* Console.log(`  workspace  ${ws.root}`);
      yield* Console.log(
        `  web        http://${host === "0.0.0.0" ? "localhost" : host}:${port}${note}`,
      );

      return yield* Effect.never;
    }).pipe(
      Effect.scoped,
      Effect.provide([appData, Workspace.layer(workspace), processLog("server")]),
    );
  }),
).pipe(Command.withDescription("Serve the web board and local API"));

const mcp = Command.make("mcp", { workspace: workspaceFlag }, ({ workspace }) =>
  // stdout carries the protocol, so nothing here may print to it.
  Layer.launch(
    mcpLayer.pipe(Layer.provide([appData, Workspace.layer(workspace), processLog("mcp")])),
  ),
).pipe(Command.withDescription("Run the MCP server over stdio for Claude Code and Codex"));

const learnCommand = Command.make(
  "learn",
  {
    workspace: workspaceFlag,
    source: Argument.String("source").pipe(
      Argument.withDescription("A link, or a file or folder on this computer"),
    ),
  },
  Effect.fn("cli.learn")(function* ({ workspace, source }) {
    const path = yield* Path.Path;
    const input = learnInputOf(source);

    // A path is typed relative to where the command runs, not to the workspace.
    const resolved = "path" in input ? { path: path.resolve(input.path) } : input;

    yield* Effect.gen(function* () {
      yield* Console.log(`Reading ${source} …`);
      const { learned, warnings } = yield* learn(resolved);

      yield* Console.log(`Learned ${learned.doc.title} → ${learned.dir}`);

      for (const warning of warnings) yield* Console.error(`  warning  ${warning}`);
    }).pipe(Effect.provide(Workspace.layer(workspace)));
  }),
).pipe(Command.withDescription("Learn a link, file, or folder into about.md for agents to read"));

const agentSetupCommand = Command.make(
  "agent-setup",
  {
    workspace: workspaceFlag,
    connect: Flag.Boolean("connect").pipe(
      Flag.withDescription("Connect Claude Code and Codex instead of printing the commands"),
      Flag.withDefault(false),
    ),
  },
  ({ workspace, connect }) =>
    (connect ? connectAgents() : printAgentSetup()).pipe(
      Effect.provide(Workspace.layer(workspace)),
    ),
).pipe(
  Command.withDescription("Connect Claude Code and Codex, or print the commands to do it yourself"),
);

const READINESS = {
  ready: "ready",
  outdated: "needs an update",
  signedOut: "needs a sign-in",
  missing: "not installed",
};

/** The agent CLIs on this machine, before any workspace; the desktop app reads `--json`. */
const agents = Command.make(
  "agents",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the agents as JSON"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("cli.agents")(function* ({ json }) {
    const setups = yield* agentSetup();

    if (json) return yield* Console.log(yield* Schema.encodeEffect(AgentSetupJson)(setups));

    for (const { agent, state, version, fix } of setups) {
      const named = version === undefined ? agent : `${agent} ${version}`;
      const line = `  ${state === "ready" ? "✓" : "–"} ${named.padEnd(16)} ${READINESS[state]}`;
      yield* Console.log(fix === undefined ? line : `${line}: ${fix}`);
    }
  }),
).pipe(Command.withDescription("Check that Claude Code and Codex are installed and signed in"));

const cutfac = Command.make("cutfac").pipe(
  Command.withDescription("Cutfac — make short-form videos with your own agent"),
  Command.withSubcommands([init, serve, mcp, learnCommand, agentSetupCommand, agents]),
);

/**
 * Command.run already renders parse errors and help. Everything else is a core error with a
 * message meant for people, or a defect worth the full cause.
 */
const report = (cause: Cause.Cause<unknown>) => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.void;
  const error = Cause.findErrorOption(cause);

  if (Option.isNone(error)) return Console.error(Cause.pretty(cause));

  if (CliError.isCliError(error.value)) return Effect.void;
  const message = describeError(error.value);

  return Console.error(message);
};

Command.run(cutfac, { version: MCP_VERSION }).pipe(
  Effect.tapCause(report),
  Effect.provide([FetchHttpClient.layer, BunServices.layer]),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
