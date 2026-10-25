import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { CommandFailed, InvalidRequest, NotFound } from "../src/core/errors.ts";
import {
  ABOUT_FILE,
  UNREAD,
  aboutSection,
  aboutSections,
  forget,
  getLearned,
  learn,
  learnInputOf,
  learnNotices,
  listLearned,
  readAbout,
  summarize,
} from "../src/core/learn.ts";
import { type FakeAgents, makeFakeAgents, makeWorkspace, type TestWorkspace } from "./support.ts";

const LANDING = `<html><head>
<title>Fernly | Plant care reminders</title>
<meta content="Fernly — Plant care one reminder at a time" property="og:title"/>
<meta name="description" content="Care for your plants in two minutes a day &amp; never miss a watering.">
<link rel="icon" href="/favicon.png">
<meta property="og:image" content="/og.png">
</head><body><a href="https://apps.apple.com/us/app/fernly/id123456">App Store</a></body></html>`;

const LOOKUP = {
  results: [
    {
      trackName: "Fernly: Plant Care",
      trackViewUrl: "https://apps.apple.com/us/app/fernly/id123456?uo=4",
      description: "Learn what each plant needs. Reminders keep watering on time.",
      sellerName: "Fernly Labs",
      artworkUrl512: "https://is1.mzstatic.com/icon/512x512bb.jpg",
      screenshotUrls: ["https://is1.mzstatic.com/a/shot1.jpg/392x696bb.jpg"],
    },
  ],
};

const SHORT = `<title>Repotting in 30s - YouTube</title>
<meta property="og:title" content="Repotting in 30s">
<meta property="og:image" content="https://i.ytimg.com/vi/abc/hq.jpg">`;

const PICTURE = () =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });

/** Canned pages; any other URL is a picture. */
function respond(url: string): Response {
  if (url.startsWith("https://itunes.apple.com/lookup")) return Response.json(LOOKUP);

  if (url === "https://fernly.app/") return new Response(LANDING);

  if (url === "https://www.youtube.com/shorts/abc") return new Response(SHORT);

  if (url.startsWith("https://www.youtube.com/")) return new Response("gone", { status: 404 });

  return PICTURE();
}

/** The landing page with an SVG icon, which the board does not show. */
const svgIcon = (url: string) =>
  url.endsWith("/favicon.png")
    ? new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })
    : respond(url);

/** An HttpClient that answers from `answer` and records each requested URL in `requested`. */
const fakeHttp = (requested: string[], answer: (url: string) => Response = respond) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.sync(() => {
        requested.push(url.href);

        return HttpClientResponse.fromWeb(request, answer(url.href));
      }),
    ),
  );

describe("reading what was given", () => {
  test("a link is anything with a scheme or a www. prefix; the rest is a path", () => {
    expect(learnInputOf(" https://fernly.app ")).toEqual({ url: "https://fernly.app" });
    expect(learnInputOf("www.fernly.app")).toEqual({ url: "https://www.fernly.app" });
    expect(learnInputOf("~/code/fernly")).toEqual({ path: "~/code/fernly" });
    expect(learnInputOf("fernly.app")).toEqual({ path: "fernly.app" });
  });

  test("summarize takes the first heading and the first real paragraph", () => {
    const readme = [
      "---",
      "title: ignored",
      "---",
      "<!-- comment -->",
      '<p align="center"><img src="logo.png"></p>',
      "",
      "# **Fernly**",
      "",
      "[![CI](https://ci/badge.svg)](https://ci)",
      "",
      "Care for your plants with [smart reminders](https://x).",
      "One plant at a time.",
      "",
      "## Install",
    ].join("\n");

    expect(summarize(readme)).toEqual({
      title: "Fernly",
      description: "Care for your plants with smart reminders. One plant at a time.",
    });
    expect(summarize("")).toEqual({ description: "" });
    expect(summarize("x".repeat(600)).description).toHaveLength(500);
  });

  test("a heading inside a description does not split its section", () => {
    const section = aboutSection("fernly", "learned/fernly", {
      kind: "app",
      title: "Fernly",
      description: "What it does\n# Features\nReminders",
      images: [],
      links: [],
      addedAt: "2026-10-16T00:00:00.000Z",
    });

    expect(section).toContain("What it does\n\\# Features\n");
    expect(aboutSections(`# About\n\n${section}\n`).map((found) => found.id)).toEqual([
      undefined,
      "fernly",
    ]);
  });
});

describe("learn", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;
  let outside: string;
  const requested: string[] = [];

  beforeEach(async () => {
    t = await makeWorkspace();
    // A PATH of only fakes: yt-dlp and whisper are never found, so nothing is downloaded or run.
    fakes = await makeFakeAgents();
    outside = await mkdtemp(join(tmpdir(), "cutfac-learn-"));
    requested.length = 0;
  });

  afterEach(async () => {
    await t.remove();
    await fakes.remove();
    await rm(outside, { recursive: true, force: true });
  });

  const offline = (answer?: (url: string) => Response) =>
    Layer.merge(fakeHttp(requested, answer), fakes.layer);

  const about = () => readFile(join(t.root, ABOUT_FILE), "utf8");

  test("a landing page keeps its icon and picture and starts a section in about.md", async () => {
    const { learned, warnings } = await t.runWith(
      offline(),
      learn(learnInputOf("https://fernly.app")),
    );

    expect(warnings).toEqual([]);
    expect(learned.id).toBe("fernly");
    expect(learned.dir).toBe("learned/fernly");
    expect(learned.unread).toBe(true);
    expect(learned.doc).toMatchObject({
      kind: "page",
      title: "Fernly — Plant care one reminder at a time",
      description: "Care for your plants in two minutes a day & never miss a watering.",
      source: { url: "https://fernly.app/" },
      site: "Fernly",
      icon: "icon.png",
      images: ["image.png"],
      links: ["https://apps.apple.com/us/app/fernly/id123456"],
    });
    // Store links on the page are noted, not followed.
    expect(requested.toSorted()).toEqual([
      "https://fernly.app/",
      "https://fernly.app/favicon.png",
      "https://fernly.app/og.png",
    ]);
    expect((await readdir(join(t.root, learned.dir))).toSorted()).toEqual([
      "icon.png",
      "image.png",
      "learned.yaml",
    ]);

    const text = await about();

    expect(text).toStartWith("# About\n");
    expect(text).toContain(
      "## Fernly — Plant care one reminder at a time\n<!-- learned:fernly -->\n",
    );
    expect(text).toContain(`${UNREAD}: `);
    expect(text).toContain("- Link: https://fernly.app/\n- By: Fernly\n");
    expect(text).toContain("- Saved: learned/fernly/\n\nCare for your plants");
  });

  test("an app keeps its full description, icon, and screenshots", async () => {
    const { learned } = await t.runWith(
      offline(),
      learn({ url: "https://apps.apple.com/us/app/fernly/id123456" }),
    );

    expect(learned.doc).toMatchObject({
      kind: "app",
      title: "Fernly: Plant Care",
      description: "Learn what each plant needs. Reminders keep watering on time.",
      site: "Fernly Labs",
      icon: "icon.png",
      images: ["shot-01.png"],
    });
  });

  test("a picture the board cannot show safely is left out with a warning", async () => {
    const { learned, warnings } = await t.runWith(
      offline(svgIcon),
      learn({ url: "https://fernly.app" }),
    );

    expect(learned.doc.icon).toBeUndefined();
    expect(learned.doc.images).toEqual(["image.png"]);
    expect(warnings).toEqual([
      "Could not download https://fernly.app/favicon.png: https://fernly.app/favicon.png: not a picture the board can show (image/svg+xml)",
    ]);
  });

  test("without yt-dlp a video link is kept as its page, with a warning", async () => {
    const { learned, warnings } = await t.runWith(
      offline(),
      learn({ url: "https://www.youtube.com/shorts/abc" }),
    );

    expect(learned.doc).toMatchObject({
      kind: "page",
      title: "Repotting in 30s",
      images: ["image.png"],
    });
    expect(learned.doc.video).toBeUndefined();
    expect(warnings).toEqual([
      "Saved as a page without the video: yt-dlp is required to download videos from links (brew install yt-dlp).",
    ]);
  });

  test("a video link with neither its page nor yt-dlp leaves nothing behind", async () => {
    const error = await t.runWith(
      offline(),
      Effect.flip(learn({ url: "https://www.youtube.com/watch?v=gone" })),
    );

    expect(error).toBeInstanceOf(CommandFailed);
    expect(await readdir(join(t.root, "learned"))).toEqual([]);
    expect(await t.run(readAbout())).toBeUndefined();
  });

  test("a link with a login in it is refused before anything is fetched", async () => {
    const error = await t.runWith(
      offline(),
      Effect.flip(learn({ url: "https://me:pass@fernly.app/" })),
    );

    expect(error).toBeInstanceOf(InvalidRequest);
    expect(requested).toEqual([]);
  });

  test("a folder is summarized from its README and stays where it is", async () => {
    const folder = join(outside, "fernly-app");
    await mkdir(folder);
    await writeFile(join(folder, "README.md"), "# Fernly\n\nA plant care tracker.\n");
    await writeFile(join(folder, "main.ts"), "export {};\n");

    const { learned } = await t.runWith(offline(), learn(learnInputOf(folder)));

    expect(learned.doc).toMatchObject({
      kind: "folder",
      title: "Fernly",
      description: "A plant care tracker.",
      source: { path: folder },
    });
    expect(await readdir(join(t.root, learned.dir))).toEqual(["learned.yaml"]);
    expect(await about()).toContain(`- Folder: ${folder}\n`);
  });

  test("a missing path is refused", async () => {
    const error = await t.runWith(offline(), Effect.flip(learn({ path: join(outside, "nope") })));

    expect(error).toBeInstanceOf(InvalidRequest);
  });

  test("an uploaded note is copied in, since its temporary file goes away", async () => {
    const upload = join(outside, "upload-123");
    await writeFile(upload, "# Launch plan\n\nShip the spring update in May.\n");

    const { learned } = await t.runWith(offline(), learn({ file: upload, name: "plan.md" }));

    expect(learned.doc).toMatchObject({
      kind: "file",
      title: "Launch plan",
      description: "Ship the spring update in May.",
    });
    expect(learned.doc.source).toBeUndefined();
    expect((await readdir(join(t.root, learned.dir))).toSorted()).toEqual([
      "file.md",
      "learned.yaml",
    ]);
    expect(await about()).toContain("- Uploaded file\n");
  });

  test("the same title gets its own folder", async () => {
    const note = join(outside, "a.md");
    await writeFile(note, "# Fernly\n");

    const ids = await t.runWith(
      offline(),
      Effect.gen(function* () {
        const first = yield* learn({ path: note });
        const second = yield* learn({ path: note });

        return [first.learned.id, second.learned.id];
      }),
    );

    expect(ids).toEqual(["fernly", "fernly-2"]);
  });

  test("a section stops being unread once an agent rewrites it, and forget removes it", async () => {
    const first = join(outside, "a.md");
    await writeFile(first, "# First\n");
    const second = join(outside, "b.md");
    await writeFile(second, "# Second\n");

    await t.runWith(offline(), learn({ path: first }));
    await t.runWith(offline(), learn({ path: second }));

    const unread = async () =>
      Object.fromEntries(
        (await t.run(listLearned())).map((entry) => [entry.id, entry.unread] as const),
      );

    expect(await unread()).toEqual({ first: true, second: true });

    // An agent rewrites the first section and a person adds one of their own.
    const read = (await about()).replace(/(<!-- learned:first -->\n)> Not read yet[^\n]*\n/, "$1");
    await writeFile(join(t.root, ABOUT_FILE), `${read}\n## Voice\n\nPlayful.\n`);

    expect(await unread()).toEqual({ first: false, second: true });

    const notices = learnNotices(await t.run(listLearned()), "/w/about.md");

    expect(notices).toHaveLength(1);
    expect(notices[0]).toStartWith("/w/about.md has sections no agent has read yet (second).");

    await t.run(forget("second"));

    const left = await about();

    expect(left).toContain("<!-- learned:first -->");
    expect(left).not.toContain("learned:second");
    expect(left).toEndWith("## Voice\n\nPlayful.\n");
    expect(await readdir(join(t.root, "learned"))).toEqual(["first"]);
    expect(await t.fail(getLearned("second"))).toBeInstanceOf(NotFound);
    expect(await t.fail(getLearned("../escape"))).toBeInstanceOf(NotFound);
    expect(learnNotices(await t.run(listLearned()), "/w/about.md")).toEqual([]);
  });
});

const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

describe.skipIf(!hasFfmpeg)("learning a video file", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;
  let outside: string;

  beforeEach(async () => {
    t = await makeWorkspace();
    fakes = await makeFakeAgents();
    outside = await mkdtemp(join(tmpdir(), "cutfac-learn-"));
  });

  afterEach(async () => {
    await t.remove();
    await fakes.remove();
    await rm(outside, { recursive: true, force: true });
  });

  test("copies it in and preprocesses it", async () => {
    const video = join(outside, "Hook idea.mp4");

    const made = Bun.spawnSync([
      "ffmpeg",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=180x320:rate=30:duration=2",
      "-pix_fmt",
      "yuv420p",
      video,
    ]);

    expect(made.exitCode).toBe(0);

    const { learned } = await t.runWith(
      Layer.merge(fakeHttp([]), fakes.layer),
      learn({ path: video }),
    );

    expect(learned.doc).toMatchObject({
      kind: "video",
      title: "Hook idea",
      video: "source.mp4",
      probe: { width: 180, height: 320, hasAudio: false },
    });
    expect(learned.preprocess?.frames.length).toBeGreaterThan(0);
    expect(learned.preprocess?.contactSheet).toBe("contact.jpg");

    const got = await t.run(getLearned(learned.id));

    expect(got.preprocess?.contactSheet).toBe("contact.jpg");
  }, 20_000);
});
