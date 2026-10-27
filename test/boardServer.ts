import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The web handler is the test's entry point, so it provides every layer the routes need.
// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform } from "@effect/platform-bun";
import { ConfigProvider, Layer, ManagedRuntime, Option } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import { RunRegistry } from "../src/core/agentRun.ts";
import { AppData } from "../src/core/appData.ts";
import { ImportRuns } from "../src/core/importRun.ts";
import { DesktopData } from "../src/plan.ts";
import { routes } from "../src/server/app.ts";
import { setUpClaudePlugins } from "./pluginFixtures.ts";
import { testLicenseKey, type FakeAgents, type TestWorkspace } from "./support.ts";

// The board reads its server's address when it loads, and has no browser to ask here.
Object.assign(globalThis, { location: { search: "?api=http://cutfac.test" } });

export const { api, onAgentRun } = await import("../web/src/api.ts");

export const { approvalsApi } = await import("../web/src/approvalsApi.ts");

export const { briefApi } = await import("../web/src/briefApi.ts");

export const { mcpApi } = await import("../web/src/mcpApi.ts");

export const { permissionsApi } = await import("../web/src/permissionsApi.ts");

export const { onItemRender, stopRender } = await import("../web/src/renderApi.ts");

const FORMAT = `title: Art
summary: A short film
references: [refs/mood.png]
aspects: [9x16, 1x1]
duration: { min: 10, max: 30 }
requireAudio: true
hookRules: [Start loud]
structure: [Hook, Body]
checklist: [Captions on]
source: { url: "https://example.com/art", author: Ada, license: MIT }
skills: [{ name: ink, source: owner/ink }, { name: ghost }]
requires: [surely-not-installed-cutfac]
inputs:
  - id: style
    title: Style
    description: Pick one
    required: true
    default: swiss
    choices:
      - { id: swiss, title: Swiss, summary: Clean, preview: previews/swiss.png, files: [style/swiss.md] }
      - { id: neon, title: Neon }
`;

const PROBED = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { duration: "21.5" },
});

const CODEX = `case "$1 $2" in
  "debug models") cat <<'JSON'
{"models":[{"slug":"gpt-a","display_name":"GPT A","visibility":"list","priority":1,"default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low"},{"effort":"medium"}],"supports_reasoning_effort_updates":true}]}
JSON
  exit 0 ;;
esac
[ "$1" = "--version" ] && { echo "codex-cli 0.163.0"; exit 0; }
exit 1
`;

const CLAUDE = `case "$1" in
  --version) echo "2.0.0 (Claude Code)"; exit 0 ;;
esac
head -n 1 > /dev/null
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
echo '{"type":"result","subtype":"success","session_id":"sess-1","result":"Done."}'
`;

/** An EventSource that reads the server's streams in process, as a browser's would over HTTP. */
export class StreamSource {
  static readonly opened: StreamSource[] = [];

  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  private readonly abort = new AbortController();

  constructor(url: string) {
    StreamSource.opened.push(this);
    void this.read(url);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }

  close() {
    this.abort.abort();
  }

  private async read(url: string) {
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      const response = await fetch(url, { signal: this.abort.signal });

      for await (const chunk of response.body ?? []) {
        buffer += decoder.decode(chunk, { stream: true });

        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const lines = buffer.slice(0, end).split("\n");
          buffer = buffer.slice(end + 2);

          const field = (name: string) =>
            lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);

          this.emit(field("event") ?? "message", field("data") ?? "");
        }
      }
    } catch {
      // Closing the source aborts the read.
    }
  }
}

/** Waits for `condition`, which the server's streams make true on their own time. */
export async function until(condition: () => boolean) {
  for (let tries = 0; !condition(); tries++) {
    if (tries > 200) throw new Error("The stream never said what the test waits for");

    await Bun.sleep(10);
  }
}

export interface BoardServer {
  /** A new folder, removed when the server stops. */
  readonly tempFolder: (prefix: string) => Promise<string>;
  /** `during` with the board talking to the desktop app's server, whose data folder is `data`. */
  readonly onDesktop: <A>(data: string, during: () => Promise<A>) => Promise<A>;
  readonly stop: () => Promise<void>;
}

/**
 * The server's routes on the test workspace `t`, which the board's own API client talks to: fake
 * agents, a format, and the agents' settings and servers for the board to read.
 */
export async function startBoardServer(t: TestWorkspace, fakes: FakeAgents): Promise<BoardServer> {
  const folders: string[] = [];

  const tempFolder = async (prefix: string) => {
    const folder = await mkdtemp(join(tmpdir(), `cutfac-${prefix}-`));
    folders.push(folder);

    return folder;
  };

  const config = await tempFolder("agent-config");

  const serve = async (extra: Layer.Layer<never>) => {
    const env = ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: { PATH: join(fakes.dir, "bin"), CLAUDE_CONFIG_DIR: config, CODEX_HOME: config },
      }),
    );

    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        RunRegistry.layer(undefined),
        ImportRuns.layer,
        FetchHttpClient.layer,
        BunHttpPlatform.layer,
        extra,
      ).pipe(Layer.provideMerge(t.layer), Layer.provideMerge(env)),
    );

    const context = await runtime.context();

    const app = routes({ cli: { command: "cutfac", args: ["mcp"] } }).pipe(
      Layer.provide(Layer.merge(t.layer, BunHttpPlatform.layer)),
    );

    const web = HttpRouter.toWebHandler(app, { disableLogger: true });

    return {
      handle: (request: Request) => web.handler(request, context),
      dispose: async () => {
        await web.dispose();
        await runtime.dispose();
      },
    };
  };

  const main = await serve(Layer.succeed(AppData, Option.some(await tempFolder("app"))));
  let serving = main.handle;
  const realFetch = globalThis.fetch;
  const realPath = process.env["PATH"];

  Object.assign(globalThis, {
    fetch: (input: string, init?: RequestInit) => serving(new Request(input, init)),
    EventSource: StreamSource,
  });

  await fakes.bin("claude", CLAUDE);
  await fakes.bin("codex", CODEX);
  await fakes.bin("ffprobe", `cat <<'EOF'\n${PROBED}\nEOF\n`);
  // Child processes find programs on the real PATH, so the fake ffprobe goes first on it.
  process.env["PATH"] = `${join(fakes.dir, "bin")}:${realPath}`;

  await mkdir(join(t.root, "formats/art"), { recursive: true });
  await writeFile(join(t.root, "formats/art/format.yaml"), FORMAT);
  await writeFile(join(t.root, "formats/art/README.md"), "# Art\n");
  await mkdir(join(t.root, "formats/broken"), { recursive: true });
  await writeFile(join(t.root, "formats/broken/format.yaml"), "summary: no title\n");
  await mkdir(join(t.root, ".claude/skills/ink"), { recursive: true });
  await writeFile(join(t.root, ".claude/skills/ink/SKILL.md"), "---\nname: ink\n---\n");
  await writeFile(join(t.root, ".claude/settings.json"), JSON.stringify({ env: { A: "1" } }));
  await writeFile(join(t.root, ".claude/settings.local.json"), "not json");

  await setUpClaudePlugins(
    config,
    {
      "docs@market": {
        files: {
          ".claude-plugin/plugin.json": { name: "docs", description: "Search the docs" },
          ".mcp.json": { mcpServers: { search: { command: "${CLAUDE_PLUGIN_ROOT}/bin/search" } } },
        },
      },
    },
    { "docs@market": true },
  );

  await writeFile(
    join(config, "config.toml"),
    'sandbox_mode = "workspace-write"\napproval_policy = "on-request"\n',
  );

  await writeFile(
    join(config, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        remote: { type: "http", url: "https://example.com/mcp?key=1", headers: { A: "b" } },
        local: { command: "node", args: ["server.js"], env: { TOKEN: "x" } },
      },
    }),
  );

  const onDesktop = async <A>(data: string, during: () => Promise<A>) => {
    const desktop = await serve(
      Layer.mergeAll(Layer.succeed(DesktopData, Option.some(data)), testLicenseKey),
    );

    serving = desktop.handle;

    try {
      return await during();
    } finally {
      serving = main.handle;
      await desktop.dispose();
    }
  };

  const stop = async () => {
    Object.assign(globalThis, { fetch: realFetch });
    Reflect.deleteProperty(globalThis, "EventSource");
    Reflect.deleteProperty(globalThis, "location");
    process.env["PATH"] = realPath;
    await main.dispose();
    await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
  };

  return { tempFolder, onDesktop, stop };
}
