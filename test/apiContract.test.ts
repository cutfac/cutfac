import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveEdit, saveVariant } from "../src/core/edits.ts";
import { api, startBoardServer, type BoardServer } from "./boardServer.ts";
import {
  makeFakeAgents,
  makeWorkspace,
  signedGrant,
  type FakeAgents,
  type TestWorkspace,
} from "./support.ts";

describe("the board's API client against the server's routes: items and the workspace", () => {
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

  test("an item through its life: made, changed, attached to, asked about, decided on, undone", async () => {
    const made = await api.createItem({ title: "Takes", format: "art", inputs: { style: "neon" } });
    const id = made.id;

    expect(made).toMatchObject({
      id: "art/takes",
      running: false,
      doc: { format: "art", inputs: { style: "neon" } },
    });
    expect(await api.items()).toMatchObject([
      { id, title: "Takes", format: "art", status: "drafting" },
    ]);

    const patched = await api.updateItem(id, {
      status: "review",
      hook: "Wait for it",
      notes: "Cut the intro",
      sources: [{ path: t.root }, { url: "https://example.com/pack" }],
    });

    expect(patched.doc).toMatchObject({
      status: "review",
      hook: "Wait for it",
      notes: "Cut the intro",
      sources: [{ path: "." }, { url: "https://example.com/pack" }],
    });

    const withVideo = await api.uploadMedia(id, new File([new Uint8Array([0, 1, 2])], "take.mp4"));
    const video = withVideo.media[0]?.name ?? "";

    expect(withVideo.media).toMatchObject([
      { name: "[9x16] take.mp4", kind: "video", aspect: "9x16" },
    ]);

    await writeFile(join(t.root, withVideo.dir, "cover.png"), "png");

    const reviewDir = join(t.root, withVideo.dir, "review", "[9x16] take");

    await mkdir(reviewDir, { recursive: true });
    await writeFile(
      join(reviewDir, "review.yaml"),
      `file: ${JSON.stringify(video)}
at: "2026-10-20T00:00:00.000Z"
sheet: sheet.jpg
frames: [{ t: 0, file: t0.jpg }]
strips: [{ t: 1.5, file: s1.jpg }]
safeZone: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.05 }
notes: [No audio]
`,
    );

    expect((await api.item(id)).reviews).toMatchObject([
      {
        dir: `${withVideo.dir}/review/[9x16] take`,
        file: video,
        sheet: "sheet.jpg",
        frames: [{ t: 0, file: "t0.jpg" }],
        strips: [{ t: 1.5, file: "s1.jpg" }],
        safeZone: { top: 0.1, bottom: 0.2, left: 0.05, right: 0.05 },
        notes: ["No audio"],
      },
    ]);

    const dropped = await api.uploadReferences(id, [
      { file: new File(["png"], "logo.png"), path: "logo.png" },
      { file: new File(["jpg"], "a.jpg"), path: "photos/a.jpg" },
    ]);

    expect(dropped.added).toEqual(["references/logo.png", "references/photos"]);
    expect(dropped.item.references).toMatchObject([
      { path: "references/logo.png", name: "logo.png", dir: false, kind: "image" },
      { path: "references/photos", dir: true, files: 1 },
    ]);
    expect(dropped.item.media.map((media) => media.kind)).toEqual(["video", "image"]);

    const note = await api.addFeedback(id, { body: "Nice hook", media: video, timecode: 2 });

    expect(note.doc.feedback).toMatchObject([
      { body: "Nice hook", media: video, timecode: 2, status: "open" },
    ]);

    const asked = await api.requestEdit(id, {
      agent: "queue",
      body: "Punchier",
      media: video,
      timecode: 1,
      end: 3,
      region: { x: 0.1, y: 0.1, w: 0.5, h: 0.5, at: 1 },
      attachments: ["references/logo.png"],
      variants: 2,
    });

    expect(asked).toMatchObject({ sent: "queue", prompt: expect.stringContaining("Punchier") });
    expect(asked.warnings.length).toBeGreaterThan(0);

    const request = asked.item.doc.feedback.find((f) => f.id === asked.feedbackId);

    expect(request).toMatchObject({
      body: "Punchier",
      timecode: 1,
      end: 3,
      region: { w: 0.5, at: 1 },
      attachments: ["references/logo.png"],
      variants: { wanted: 2, saved: [] },
      context: { before: expect.stringContaining("before") },
    });
    expect(await api.editPrompt(id, asked.feedbackId)).toEqual({ prompt: asked.prompt });

    await writeFile(join(t.root, asked.item.dir, video), "big captions");
    await t.run(saveVariant(id, asked.feedbackId, "Big captions"));
    await writeFile(join(t.root, asked.item.dir, video), "quiet captions");
    await t.run(saveVariant(id, asked.feedbackId, "Quiet captions"));

    const [pending] = await api.items();
    const variants = pending?.requests.find((f) => f.id === asked.feedbackId)?.variants;

    expect(variants).toMatchObject({
      wanted: 2,
      media: video,
      saved: [{ label: "Big captions" }, { label: "Quiet captions" }],
    });

    const picked = await api.pickVariant(id, asked.feedbackId, variants?.saved[0]?.id ?? "");

    expect(picked.doc.feedback.find((f) => f.id === asked.feedbackId)).toMatchObject({
      decision: "approved",
      variants: { picked: "Big captions" },
    });
    expect(picked.history.entries.map((entry) => entry.kind)).toContain("media");

    expect(await api.feedback()).toMatchObject([
      { item: id, title: "Takes", feedback: { body: "Nice hook" } },
    ]);

    const resolved = await api.resolveFeedback(id, note.doc.feedback[0]?.id ?? "");

    expect(resolved.doc.feedback[0]).toMatchObject({
      status: "resolved",
      resolution: "Resolved in the web UI",
    });

    const second = await api.requestEdit(id, { agent: "queue", body: "Louder", media: video });

    await writeFile(join(t.root, second.item.dir, video), "louder");
    await t.run(resolveEdit(id, second.feedbackId, "Louder"));

    const kept = await api.approveEdit(id, second.feedbackId);

    expect(kept.doc.feedback.find((f) => f.id === second.feedbackId)).toMatchObject({
      decision: "approved",
    });

    const third = await api.requestEdit(id, { agent: "queue", body: "Quieter", media: video });

    await writeFile(join(t.root, third.item.dir, video), "quieter");
    await t.run(resolveEdit(id, third.feedbackId, "Quieter"));

    const rolledBack = await api.restoreEdit(id, third.feedbackId);

    expect(rolledBack.doc.feedback.find((f) => f.id === third.feedbackId)).toMatchObject({
      decision: "restored",
    });

    const undone = await api.undo(id);
    const redone = await api.redo(id);
    const start = await api.goTo(id, undefined);

    expect(undone.history.cursor).toBeLessThan(rolledBack.history.cursor);
    expect(redone.history.cursor).toBe(rolledBack.history.cursor);
    expect(start.history.cursor).toBe(0);

    const current = start.history.heads[video];
    const other = start.history.versions.find((version) => version.id !== current?.version);

    expect(current).toMatchObject({ size: expect.any(Number), mtime: expect.any(Number) });
    expect(other).toMatchObject({ media: video, size: expect.any(Number) });

    const restored = await api.restoreVersion(id, other?.id ?? "");

    expect(restored.history.entries.at(-1)).toMatchObject({ kind: "media", cause: "version" });

    expect(await api.cancelWaiting(id)).toMatchObject({ id });
    expect(await api.stopEdit(id)).toEqual({ ok: true });
    expect(await api.verify(id)).toMatchObject([
      {
        file: video,
        ok: true,
        checks: expect.arrayContaining([
          { name: expect.any(String), ok: true, detail: expect.any(String) },
        ]),
      },
    ]);

    const removed = await api.removeReference(id, "references/photos");

    expect(removed.references).toMatchObject([{ path: "references/logo.png" }]);
  });

  test("a failed request fails with the server's message", async () => {
    await expect(api.item("nothing")).rejects.toThrow("Item not found: nothing");
    await expect(api.createItem({ title: "  " })).rejects.toThrow(/title/i);
  });

  test("the workspace lists its formats and what each lacks", async () => {
    expect(await api.health()).toEqual({ ok: true });

    const info = await api.workspace();

    expect(info).toMatchObject({ name: "Contract", config: { agent: { default: "claude" } } });
    expect(info.formats).toMatchObject([
      {
        id: "art",
        dir: "formats/art",
        readme: "# Art\n",
        doc: {
          title: "Art",
          aspects: ["9x16", "1x1"],
          duration: { min: 10, max: 30 },
          source: { url: "https://example.com/art", author: "Ada", license: "MIT" },
          skills: [{ name: "ink", source: "owner/ink" }, { name: "ghost" }],
          inputs: [
            {
              id: "style",
              required: true,
              default: "swiss",
              choices: [
                { id: "swiss", preview: "previews/swiss.png", files: ["style/swiss.md"] },
                { id: "neon" },
              ],
            },
          ],
        },
      },
    ]);
    expect(await api.formats()).toEqual(info.formats);

    expect(await api.formatStatuses()).toMatchObject([
      {
        id: "art",
        format: { id: "art" },
        check: {
          ready: false,
          skills: { ink: ".claude/skills/ink/SKILL.md" },
          problems: expect.arrayContaining([
            { kind: "skill", subject: "ghost", message: expect.any(String) },
            {
              kind: "program",
              subject: "surely-not-installed-cutfac",
              message: expect.any(String),
            },
            { kind: "file", subject: "previews/swiss.png", message: expect.any(String) },
          ]),
        },
      },
      { id: "broken", check: { ready: false, problems: [{ kind: "spec" }] } },
    ]);
  });

  test("the plan is the open-source one, or the desktop app's free version and then its paid one", async () => {
    expect(await api.plan()).toEqual({ edition: "open-source" });

    const data = await server.tempFolder("desktop");

    await server.onDesktop(data, async () => {
      expect(await api.plan()).toEqual({ edition: "desktop", paid: false, used: 0, limit: 3 });

      await writeFile(
        join(data, "settings.json"),
        JSON.stringify({ licenseKey: "KEY-1", license: { token: signedGrant(Date.now()) } }),
      );

      expect(await api.plan()).toEqual({ edition: "desktop", paid: true });
    });
  });
});
