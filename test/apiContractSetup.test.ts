import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beginTurn, createImport, endTurn } from "../src/core/imports.ts";
import { RENDERS_DIR, type RenderState } from "../src/core/render.ts";
import {
  api,
  approvalsApi,
  briefApi,
  mcpApi,
  onAgentRun,
  onItemRender,
  permissionsApi,
  startBoardServer,
  stopRender,
  StreamSource,
  until,
  type BoardServer,
} from "./boardServer.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

describe("the board's API client against the server's routes: agents, settings and streams", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;
  let server: BoardServer;

  beforeAll(async () => {
    t = await makeWorkspace("Contract");
    fakes = await makeFakeAgents();
    server = await startBoardServer(t, fakes);
  });

  afterAll(async () => {
    await server.stop();
    await fakes.remove();
    await t.remove();
  });

  test("the agents, what runs from the board may do, and the servers it may use", async () => {
    expect(await api.agents()).toMatchObject([
      {
        agent: "claude",
        installed: true,
        connected: false,
        version: "2.0.0",
        outdated: { minimum: "2.1.257", update: "claude update" },
        models: expect.arrayContaining([
          { id: expect.any(String), label: expect.any(String), efforts: expect.any(Array) },
        ]),
        efforts: expect.any(Array),
      },
      {
        agent: "codex",
        installed: true,
        version: "0.163.0",
        defaultModel: "GPT A",
        models: [
          {
            id: "gpt-a",
            label: "GPT A",
            efforts: ["low", "medium"],
            defaultEffort: "medium",
            effortKeepsCache: true,
          },
        ],
        efforts: ["low", "medium"],
      },
    ]);

    expect(await api.connectAgent("claude")).toMatchObject({ agent: "claude", ok: true });
    expect(await api.connectAgent("codex")).toMatchObject({ agent: "codex", ok: false });
    expect((await api.agents())[0]).toMatchObject({ agent: "claude", connected: true });

    expect(await permissionsApi.list()).toMatchObject([
      { agent: "claude", mode: "follow", follows: expect.any(String) },
      { agent: "codex", mode: "follow", setting: "workspace-write · on-request" },
    ]);
    expect(await permissionsApi.set({ agent: "claude", mode: "edit" })).toMatchObject({
      agent: "claude",
      mode: "edit",
    });

    const status = await mcpApi.servers();

    expect(status.problems).toEqual([expect.stringContaining("Codex")]);

    const remote = status.servers.find((one) => one.name === "remote");
    const local = status.servers.find((one) => one.name === "local");

    expect(remote).toMatchObject({
      agent: "claude",
      source: "user",
      state: "new",
      kind: "url",
      headers: ["A"],
      env: [],
    });
    expect(local).toMatchObject({ kind: "command", launch: "node server.js", env: ["TOKEN"] });
    expect(status.plugins).toMatchObject([
      {
        id: "docs@market",
        title: "docs",
        description: "Search the docs",
        state: "new",
        servers: [{ name: "search", kind: "command", env: [] }],
      },
    ]);

    const decided = await mcpApi.decide({
      agent: "claude",
      name: "local",
      fingerprint: local?.fingerprint ?? "",
      on: true,
    });

    expect(decided).toMatchObject({ name: "local", state: "on" });

    const plugin = await mcpApi.decidePlugin({
      agent: "claude",
      id: "docs@market",
      fingerprint: status.plugins[0]?.fingerprint ?? "",
      on: false,
    });

    expect(plugin).toMatchObject({ id: "docs@market", state: "off" });
  });

  test("the workspace's trust, and the choices about reports", async () => {
    const trust = await api.trust();

    expect(trust).toMatchObject({
      needed: true,
      items: [
        { file: ".claude/settings.json", key: "env", value: { A: "1" } },
        { file: ".claude/settings.local.json", value: "not json" },
      ],
    });
    expect(await api.trustWorkspace(trust.fingerprint)).toMatchObject({
      needed: false,
      fingerprint: trust.fingerprint,
    });

    expect(await api.errorReports()).toEqual({
      available: false,
      errorReports: null,
      usageStats: null,
      installId: null,
    });

    const chosen = await api.setReportChoices({ errorReports: true, usageStats: false });

    expect(chosen).toMatchObject({
      errorReports: true,
      usageStats: false,
      installId: expect.any(String),
    });
    expect(await api.resetInstallId()).toMatchObject({
      errorReports: true,
      installId: expect.any(String),
    });
    expect((await api.resetInstallId()).installId).not.toBe(chosen.installId);
    expect(await api.teamFeedbackLogs()).toEqual({ logs: null, errors: 0 });
    expect(await api.onboardingFinished({ screen_recording: true, accessibility: false })).toEqual({
      ok: true,
    });
  });

  test("imports with their turns, and what was learned", async () => {
    const link = "https://example.com/pack";
    const created = await t.run(createImport({ link, agent: "claude" }));
    const at = new Date().toISOString();

    await t.run(beginTurn(created.id, { id: "turn1", kind: "start", body: link }, at));
    await t.run(
      endTurn(created.id, "turn1", {
        status: "done",
        reply: "Found two templates",
        finishedAt: at,
        model: "gpt-a",
        effort: "low",
        compacted: true,
        effortKeepsCache: true,
      }),
    );

    expect(await api.imports()).toMatchObject([
      { id: created.id, running: false, doc: { link, kind: "link" } },
    ]);

    const detail = await api.import(created.id);

    expect(detail).toMatchObject({
      id: created.id,
      dir: `.cutfac/imports/${created.id}`,
      references: [],
      doc: {
        agent: "claude",
        allowed: false,
        turns: [
          {
            id: "turn1",
            kind: "start",
            body: link,
            run: {
              status: "done",
              reply: "Found two templates",
              model: "gpt-a",
              effort: "low",
              compacted: true,
              effortKeepsCache: true,
            },
          },
        ],
      },
    });
    expect(await api.stopImport(created.id)).toMatchObject({ id: created.id, running: false });
    expect(await api.closeImport(created.id)).toMatchObject({ doc: { closed: true } });

    const folder = await server.tempFolder("learn");
    await writeFile(join(folder, "recipe.md"), "Whisk the eggs.\n");

    const learned = await api.learn(folder);

    expect(learned).toMatchObject({
      learned: {
        dir: expect.stringContaining("learned/"),
        unread: true,
        doc: { kind: "folder", source: { path: folder } },
      },
      warnings: expect.any(Array),
    });

    const uploaded = await api.learnFile(new File(["Notes about cooking"], "cooking.md"));
    const list = await api.learned();

    expect(list.learned.map((entry) => entry.id).toSorted()).toEqual(
      [learned.learned.id, uploaded.learned.id].toSorted(),
    );
    expect(list.about).toMatchObject({
      path: join(t.root, "about.md"),
      text: expect.stringContaining("cooking"),
    });
    expect((await api.forgetLearned(learned.learned.id)).learned.map((entry) => entry.id)).toEqual([
      uploaded.learned.id,
    ]);
  });

  test("a render in progress, the brief, and an answer the server no longer waits for", async () => {
    const reel = await api.createItem({ title: "Reel" });

    const render: RenderState = {
      item: reel.id,
      command: "bun run render",
      cwd: "",
      output: `${reel.dir}/out.mp4`,
      label: "v2",
      status: "running",
      progress: {
        stage: "frames",
        done: 10,
        total: 100,
        unit: "frames",
        percent: 0.1,
        duration: 12,
      },
      startedAt: Date.now(),
      log: ["frame 10"],
      owner: process.pid,
    };

    await mkdir(join(t.root, RENDERS_DIR), { recursive: true });
    await writeFile(
      join(t.root, RENDERS_DIR, `${encodeURIComponent(reel.id)}.json`),
      JSON.stringify(render),
    );

    const { owner, ...shown } = render;
    const summary = (await api.items()).find((item) => item.id === reel.id);

    expect(summary?.render).toMatchObject(shown);
    expect(owner).toBe(process.pid);

    const streamed: Array<typeof shown | undefined> = [];
    const stopWatching = onItemRender(reel.id, (state) => streamed.push(state));

    await until(() => streamed.length > 0);
    stopWatching();

    expect(streamed[0]).toMatchObject(shown);
    expect(await stopRender(reel.id)).toMatchObject(shown);
    expect(await stopRender("nothing-rendering")).toBeNull();

    expect(await briefApi.brief()).toEqual({
      path: join(t.root, "brief.md"),
      exists: false,
      purpose: null,
      platforms: [],
      body: "",
    });
    expect(
      await briefApi.updateBrief({
        purpose: "tips",
        platforms: ["tiktok", "reels"],
        body: "Quick dinners",
      }),
    ).toEqual({
      path: join(t.root, "brief.md"),
      exists: true,
      purpose: "tips",
      platforms: ["tiktok", "reels"],
      body: "Quick dinners",
    });

    expect(await approvalsApi.answer(reel.id, "request-1", "deny")).toEqual({ answered: false });
  });

  test("an agent's run streams to the board, which skips what it can't read", async () => {
    const reel = await api.createItem({ title: "Short" });
    const asked = await api.requestEdit(reel.id, { agent: "claude", body: "Tighten the intro" });

    expect(asked).toMatchObject({ sent: "claude", warnings: [] });

    const heard: Array<{ type: string }> = [];
    const stopWatching = onAgentRun(reel.id, (message) => heard.push(message));
    const source = StreamSource.opened.at(-1);

    await until(() => heard.some((message) => message.type === "done"));

    source?.emit("agent", "{not json");
    source?.emit("agent", JSON.stringify({ type: "no-such-event" }));
    source?.emit("agent", JSON.stringify({ type: "text", text: "Late word" }));
    stopWatching();

    expect(heard).toMatchObject([
      { type: "run", subject: asked.feedbackId },
      { type: "start", subject: asked.feedbackId, agent: "claude" },
      { type: "done", reply: "Done." },
      { type: "text", text: "Late word" },
    ]);

    const [feedback] = (await api.item(reel.id)).doc.feedback;

    expect(feedback?.run).toMatchObject({ agent: "claude", status: "done", reply: "Done." });
  });
});
