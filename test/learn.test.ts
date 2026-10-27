import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer, Ref } from "effect";
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
import { runChecked } from "../src/core/process.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace(), fakeAgents));

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

const fakeWeb = (answer: (url: string) => Response = respond) =>
  Effect.gen(function* () {
    const asked = yield* Ref.make<ReadonlyArray<string>>([]);

    const client = HttpClient.make((request, url) =>
      Effect.map(
        Ref.update(asked, (urls) => [...urls, url.href]),
        () => HttpClientResponse.fromWeb(request, answer(url.href)),
      ),
    );

    return { online: Effect.provideService(HttpClient.HttpClient, client), asked: Ref.get(asked) };
  });

const outsideFolder = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "cutfac-learn-" }),
);

const about = Effect.flatMap(Workspace, (ws) => ws.readText(ABOUT_FILE));

const listing = (rel: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ws = yield* Workspace;

    return (yield* fs.readDirectory(join(ws.root, rel))).toSorted();
  });

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
  it.live("a landing page keeps its icon and picture and starts a section in about.md", () =>
    Effect.gen(function* () {
      const web = yield* fakeWeb();

      const { learned, warnings } = yield* learn(learnInputOf("https://fernly.app")).pipe(
        web.online,
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
      expect((yield* web.asked).toSorted()).toEqual([
        "https://fernly.app/",
        "https://fernly.app/favicon.png",
        "https://fernly.app/og.png",
      ]);
      expect(yield* listing(learned.dir)).toEqual(["icon.png", "image.png", "learned.yaml"]);

      const text = yield* about;

      expect(text).toStartWith("# About\n");
      expect(text).toContain(
        "## Fernly — Plant care one reminder at a time\n<!-- learned:fernly -->\n",
      );
      expect(text).toContain(`${UNREAD}: `);
      expect(text).toContain("- Link: https://fernly.app/\n- By: Fernly\n");
      expect(text).toContain("- Saved: learned/fernly/\n\nCare for your plants");
    }),
  );

  it.live("an app keeps its full description, icon, and screenshots", () =>
    Effect.gen(function* () {
      const web = yield* fakeWeb();

      const { learned } = yield* learn({
        url: "https://apps.apple.com/us/app/fernly/id123456",
      }).pipe(web.online);

      expect(learned.doc).toMatchObject({
        kind: "app",
        title: "Fernly: Plant Care",
        description: "Learn what each plant needs. Reminders keep watering on time.",
        site: "Fernly Labs",
        icon: "icon.png",
        images: ["shot-01.png"],
      });
    }),
  );

  it.live("a picture the board cannot show safely is left out with a warning", () =>
    Effect.gen(function* () {
      const web = yield* fakeWeb(svgIcon);

      const { learned, warnings } = yield* learn({ url: "https://fernly.app" }).pipe(web.online);

      expect(learned.doc.icon).toBeUndefined();
      expect(learned.doc.images).toEqual(["image.png"]);
      expect(warnings).toEqual([
        "Could not download https://fernly.app/favicon.png: https://fernly.app/favicon.png: not a picture the board can show (image/svg+xml)",
      ]);
    }),
  );

  it.live("without yt-dlp a video link is kept as its page, with a warning", () =>
    Effect.gen(function* () {
      const web = yield* fakeWeb();

      const { learned, warnings } = yield* learn({
        url: "https://www.youtube.com/shorts/abc",
      }).pipe(web.online);

      expect(learned.doc).toMatchObject({
        kind: "page",
        title: "Repotting in 30s",
        images: ["image.png"],
      });
      expect(learned.doc.video).toBeUndefined();
      expect(warnings).toEqual([
        "Saved as a page without the video: yt-dlp is required to download videos from links (brew install yt-dlp).",
      ]);
    }),
  );

  it.live("a video link with neither its page nor yt-dlp leaves nothing behind", () =>
    Effect.gen(function* () {
      const web = yield* fakeWeb();

      const error = yield* Effect.flip(learn({ url: "https://www.youtube.com/watch?v=gone" })).pipe(
        web.online,
      );

      expect(error).toBeInstanceOf(CommandFailed);
      expect(yield* listing("learned")).toEqual([]);
      expect(yield* readAbout()).toBeUndefined();
    }),
  );

  it.live("a link with a login in it is refused before anything is fetched", () =>
    Effect.gen(function* () {
      const web = yield* fakeWeb();

      const error = yield* Effect.flip(learn({ url: "https://me:pass@fernly.app/" })).pipe(
        web.online,
      );

      expect(error).toBeInstanceOf(InvalidRequest);
      expect(yield* web.asked).toEqual([]);
    }),
  );

  it.live("a folder is summarized from its README and stays where it is", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const outside = yield* outsideFolder;
      const web = yield* fakeWeb();
      const folder = join(outside, "fernly-app");

      yield* fs.makeDirectory(folder);
      yield* fs.writeFileString(join(folder, "README.md"), "# Fernly\n\nA plant care tracker.\n");
      yield* fs.writeFileString(join(folder, "main.ts"), "export {};\n");

      const { learned } = yield* learn(learnInputOf(folder)).pipe(web.online);

      expect(learned.doc).toMatchObject({
        kind: "folder",
        title: "Fernly",
        description: "A plant care tracker.",
        source: { path: folder },
      });
      expect(yield* listing(learned.dir)).toEqual(["learned.yaml"]);
      expect(yield* about).toContain(`- Folder: ${folder}\n`);
    }),
  );

  it.live("a missing path is refused", () =>
    Effect.gen(function* () {
      const outside = yield* outsideFolder;
      const web = yield* fakeWeb();

      const error = yield* Effect.flip(learn({ path: join(outside, "nope") })).pipe(web.online);

      expect(error).toBeInstanceOf(InvalidRequest);
    }),
  );

  it.live("an uploaded note is copied in, since its temporary file goes away", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const outside = yield* outsideFolder;
      const web = yield* fakeWeb();
      const upload = join(outside, "upload-123");

      yield* fs.writeFileString(upload, "# Launch plan\n\nShip the spring update in May.\n");

      const { learned } = yield* learn({ file: upload, name: "plan.md" }).pipe(web.online);

      expect(learned.doc).toMatchObject({
        kind: "file",
        title: "Launch plan",
        description: "Ship the spring update in May.",
      });
      expect(learned.doc.source).toBeUndefined();
      expect(yield* listing(learned.dir)).toEqual(["file.md", "learned.yaml"]);
      expect(yield* about).toContain("- Uploaded file\n");
    }),
  );

  it.live("the same title gets its own folder", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const outside = yield* outsideFolder;
      const web = yield* fakeWeb();
      const note = join(outside, "a.md");

      yield* fs.writeFileString(note, "# Fernly\n");

      const first = yield* learn({ path: note }).pipe(web.online);
      const second = yield* learn({ path: note }).pipe(web.online);

      expect([first.learned.id, second.learned.id]).toEqual(["fernly", "fernly-2"]);
    }),
  );

  it.live("a section stops being unread once an agent rewrites it, and forget removes it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const ws = yield* Workspace;
      const outside = yield* outsideFolder;
      const web = yield* fakeWeb();
      const first = join(outside, "a.md");
      const second = join(outside, "b.md");

      yield* fs.writeFileString(first, "# First\n");
      yield* fs.writeFileString(second, "# Second\n");

      yield* learn({ path: first }).pipe(web.online);
      yield* learn({ path: second }).pipe(web.online);

      const unread = Effect.map(listLearned(), (entries) =>
        Object.fromEntries(entries.map((entry) => [entry.id, entry.unread] as const)),
      );

      expect(yield* unread).toEqual({ first: true, second: true });

      const read = (yield* about).replace(/(<!-- learned:first -->\n)> Not read yet[^\n]*\n/, "$1");
      yield* ws.writeText(ABOUT_FILE, `${read}\n## Voice\n\nPlayful.\n`);

      expect(yield* unread).toEqual({ first: false, second: true });

      const notices = learnNotices(yield* listLearned(), "/w/about.md");

      expect(notices).toHaveLength(1);
      expect(notices[0]).toStartWith("/w/about.md has sections no agent has read yet (second).");

      yield* forget("second");

      const left = yield* about;

      expect(left).toContain("<!-- learned:first -->");
      expect(left).not.toContain("learned:second");
      expect(left).toEndWith("## Voice\n\nPlayful.\n");
      expect(yield* listing("learned")).toEqual(["first"]);
      expect(yield* Effect.flip(getLearned("second"))).toBeInstanceOf(NotFound);
      expect(yield* Effect.flip(getLearned("../escape"))).toBeInstanceOf(NotFound);
      expect(learnNotices(yield* listLearned(), "/w/about.md")).toEqual([]);
    }),
  );
});

const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

describe.skipIf(!hasFfmpeg)("learning a video file", () => {
  it.live(
    "copies it in and preprocesses it",
    () =>
      Effect.gen(function* () {
        const outside = yield* outsideFolder;
        const web = yield* fakeWeb();
        const video = join(outside, "Hook idea.mp4");

        yield* runChecked("ffmpeg", [
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

        const { learned } = yield* learn({ path: video }).pipe(web.online);

        expect(learned.doc).toMatchObject({
          kind: "video",
          title: "Hook idea",
          video: "source.mp4",
          probe: { width: 180, height: 320, hasAudio: false },
        });
        expect(learned.preprocess?.frames.length).toBeGreaterThan(0);
        expect(learned.preprocess?.contactSheet).toBe("contact.jpg");

        const got = yield* getLearned(learned.id);

        expect(got.preprocess?.contactSheet).toBe("contact.jpg");
      }),
    20_000,
  );
});
