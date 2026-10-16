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
  isVideoLink,
  learn,
  learnInputOf,
  learnNotices,
  listLearned,
  readAbout,
  summarize,
} from "../src/core/learn.ts";
import { type FakeAgents, makeFakeAgents, makeWorkspace, type TestWorkspace } from "./support.ts";

const LANDING = `<html><head>
<title>Pawnly | Learn chess openings</title>
<meta content="Pawnly — Learn openings one move at a time" property="og:title"/>
<meta name="description" content="Drill chess openings in five minutes a day &amp; remember them.">
<link rel="icon" href="/favicon.png">
<meta property="og:image" content="/og.png">
</head><body><a href="https://apps.apple.com/us/app/pawnly/id123456">App Store</a></body></html>`;

const LOOKUP = {
  results: [
    {
      trackName: "Pawnly: Chess Openings",
      trackViewUrl: "https://apps.apple.com/us/app/pawnly/id123456?uo=4",
      description: "Learn openings by playing them. Spaced repetition keeps lines fresh.",
      sellerName: "Pawnly Labs",
      artworkUrl512: "https://is1.mzstatic.com/icon/512x512bb.jpg",
      screenshotUrls: ["https://is1.mzstatic.com/a/shot1.jpg/392x696bb.jpg"],
    },
  ],
};

const SHORT = `<title>Kings Gambit in 30s - YouTube</title>
<meta property="og:title" content="Kings Gambit in 30s">
<meta property="og:image" content="https://i.ytimg.com/vi/abc/hq.jpg">`;

const PICTURE = () =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });

/** Canned pages; any other URL is a picture. */
function respond(url: string): Response {
  if (url.startsWith("https://itunes.apple.com/lookup")) return Response.json(LOOKUP);

  if (url === "https://pawnly.app/") return new Response(LANDING);

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
    expect(learnInputOf(" https://pawnly.app ")).toEqual({ url: "https://pawnly.app" });
    expect(learnInputOf("www.pawnly.app")).toEqual({ url: "https://www.pawnly.app" });
    expect(learnInputOf("~/code/pawnly")).toEqual({ path: "~/code/pawnly" });
    expect(learnInputOf("pawnly.app")).toEqual({ path: "pawnly.app" });
  });

  test("video links are posts on video sites or video files", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=abc",
      "https://youtube.com/shorts/abc",
      "https://m.youtube.com/live/abc",
      "https://youtu.be/abc",
      "https://www.tiktok.com/@chess/video/123",
      "https://vm.tiktok.com/ZM123/",
      "https://www.instagram.com/reel/abc/",
      "https://vimeo.com/12345",
      "https://x.com/someone/status/123",
      "https://www.facebook.com/reel/123",
      "https://cdn.example.com/clip.mp4",
    ]) {
      expect(isVideoLink(link)).toBe(true);
    }

    for (const link of [
      "https://www.youtube.com/@chess",
      "https://youtu.be/",
      "https://www.tiktok.com/@chess",
      "https://www.instagram.com/chess/",
      "https://vimeo.com/channels",
      "https://x.com/someone",
      "https://pawnly.app/",
      "not a link",
    ]) {
      expect(isVideoLink(link)).toBe(false);
    }
  });

  test("summarize takes the first heading and the first real paragraph", () => {
    const readme = [
      "---",
      "title: ignored",
      "---",
      "<!-- comment -->",
      '<p align="center"><img src="logo.png"></p>',
      "",
      "# **Pawnly**",
      "",
      "[![CI](https://ci/badge.svg)](https://ci)",
      "",
      "Learn chess openings with [spaced repetition](https://x).",
      "One move at a time.",
      "",
      "## Install",
    ].join("\n");

    expect(summarize(readme)).toEqual({
      title: "Pawnly",
      description: "Learn chess openings with spaced repetition. One move at a time.",
    });
    expect(summarize("")).toEqual({ description: "" });
    expect(summarize("x".repeat(600)).description).toHaveLength(500);
  });

  test("a heading inside a description does not split its section", () => {
    const section = aboutSection("pawnly", "learned/pawnly", {
      kind: "app",
      title: "Pawnly",
      description: "What it does\n# Features\nOpenings",
      images: [],
      links: [],
      addedAt: "2026-10-16T00:00:00.000Z",
    });

    expect(section).toContain("What it does\n\\# Features\n");
    expect(aboutSections(`# About\n\n${section}\n`).map((found) => found.id)).toEqual([
      undefined,
      "pawnly",
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
    outside = await mkdtemp(join(tmpdir(), "factory-learn-"));
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
      learn(learnInputOf("https://pawnly.app")),
    );

    expect(warnings).toEqual([]);
    expect(learned.id).toBe("pawnly");
    expect(learned.dir).toBe("learned/pawnly");
    expect(learned.unread).toBe(true);
    expect(learned.doc).toMatchObject({
      kind: "page",
      title: "Pawnly — Learn openings one move at a time",
      description: "Drill chess openings in five minutes a day & remember them.",
      source: { url: "https://pawnly.app/" },
      site: "Pawnly",
      icon: "icon.png",
      images: ["image.png"],
      links: ["https://apps.apple.com/us/app/pawnly/id123456"],
    });
    // Store links on the page are noted, not followed.
    expect(requested.toSorted()).toEqual([
      "https://pawnly.app/",
      "https://pawnly.app/favicon.png",
      "https://pawnly.app/og.png",
    ]);
    expect((await readdir(join(t.root, learned.dir))).toSorted()).toEqual([
      "icon.png",
      "image.png",
      "learned.yaml",
    ]);

    const text = await about();

    expect(text).toStartWith("# About\n");
    expect(text).toContain(
      "## Pawnly — Learn openings one move at a time\n<!-- learned:pawnly -->\n",
    );
    expect(text).toContain(`${UNREAD}: `);
    expect(text).toContain("- Link: https://pawnly.app/\n- By: Pawnly\n");
    expect(text).toContain("- Saved: learned/pawnly/\n\nDrill chess openings");
  });

  test("an app keeps its full description, icon, and screenshots", async () => {
    const { learned } = await t.runWith(
      offline(),
      learn({ url: "https://apps.apple.com/us/app/pawnly/id123456" }),
    );

    expect(learned.doc).toMatchObject({
      kind: "app",
      title: "Pawnly: Chess Openings",
      description: "Learn openings by playing them. Spaced repetition keeps lines fresh.",
      site: "Pawnly Labs",
      icon: "icon.png",
      images: ["shot-01.png"],
    });
  });

  test("a picture the board cannot show safely is left out with a warning", async () => {
    const { learned, warnings } = await t.runWith(
      offline(svgIcon),
      learn({ url: "https://pawnly.app" }),
    );

    expect(learned.doc.icon).toBeUndefined();
    expect(learned.doc.images).toEqual(["image.png"]);
    expect(warnings).toEqual([
      "Could not download https://pawnly.app/favicon.png: https://pawnly.app/favicon.png: not a picture the board can show (image/svg+xml)",
    ]);
  });

  test("without yt-dlp a video link is kept as its page, with a warning", async () => {
    const { learned, warnings } = await t.runWith(
      offline(),
      learn({ url: "https://www.youtube.com/shorts/abc" }),
    );

    expect(learned.doc).toMatchObject({
      kind: "page",
      title: "Kings Gambit in 30s",
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
      Effect.flip(learn({ url: "https://me:pass@pawnly.app/" })),
    );

    expect(error).toBeInstanceOf(InvalidRequest);
    expect(requested).toEqual([]);
  });

  test("a folder is summarized from its README and stays where it is", async () => {
    const folder = join(outside, "pawnly-app");
    await mkdir(folder);
    await writeFile(join(folder, "README.md"), "# Pawnly\n\nA chess openings trainer.\n");
    await writeFile(join(folder, "main.ts"), "export {};\n");

    const { learned } = await t.runWith(offline(), learn(learnInputOf(folder)));

    expect(learned.doc).toMatchObject({
      kind: "folder",
      title: "Pawnly",
      description: "A chess openings trainer.",
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
    await writeFile(upload, "# Launch plan\n\nShip the openings pack in May.\n");

    const { learned } = await t.runWith(offline(), learn({ file: upload, name: "plan.md" }));

    expect(learned.doc).toMatchObject({
      kind: "file",
      title: "Launch plan",
      description: "Ship the openings pack in May.",
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
    await writeFile(note, "# Pawnly\n");

    const ids = await t.runWith(
      offline(),
      Effect.gen(function* () {
        const first = yield* learn({ path: note });
        const second = yield* learn({ path: note });

        return [first.learned.id, second.learned.id];
      }),
    );

    expect(ids).toEqual(["pawnly", "pawnly-2"]);
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
    outside = await mkdtemp(join(tmpdir(), "factory-learn-"));
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
