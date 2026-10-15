---
name: content-factory
description: Work inside a Content Factory workspace — turn reference short-form videos into reusable formats, produce short-form items (9:16 video, carousels) that market the user's app, handle review feedback from the web board, verify uploads, and record scheduling and metrics. Use whenever the user mentions references, formats, items, the board, feedback, or short-form content for their app.
---

# Content Factory

The workspace is the source of truth. Everything lives on the user's machine as folders and YAML;
the `content-factory` MCP tools read and write the same files, and the user watches results in the
local web board (`factory serve`). Use the MCP tools for structured fields; write media directly
into folders.

## Start of every task

1. `workspace_overview` — config, item counts, formats, open feedback.
2. `get_product` — what the app is, who it is for, store links, CTA rules, brand, and reviewed app
   captures. Never invent app features or UI; only show captures from `product/captures/` or what
   the user provides.
3. If there is open feedback, ask whether to handle it first (`list_open_feedback`).
4. If the product is missing or still says "My App", ask for an App Store, Google Play, or website
   link and call `import_product`. Then read `product/store/listing.md` and agree on `audience` and
   `voice` with the user. Store screenshots in `product/store/` are marketing images, not reviewed
   captures.

## Model

- **Reference** (`references/<id>/`): a video the user wants to learn from. Preprocessing produces
  `preprocess.json` (scene cuts, sampled frames, contact sheet, audio, optional transcript).
- **Format** (`formats/<id>/format.yaml`, a "template" on the board): a reusable recipe — aspects,
  duration range, hook rules, beat structure, checklist, the skills and programs it is made with,
  the inputs decided per item (such as a style), and an optional `render` command plus `template/`
  code. It is distilled from references or brought in from a link.
- **Item** (`items/<id>/item.yaml` + media): one publishable post. Status flows
  `idea → drafting → review → approved → scheduled → published` (or `archived`).

## Analyze a reference

1. `get_reference`; open `contact.jpg` and the hook frames (`frames/t000.0.jpg` … `t003.0.jpg`).
   Read the transcript if present, or transcribe `audio.wav` yourself if you can.
2. Write the analysis with `save_reference_analysis`, using these sections:
   - **Hook (0–3s)** — what is on screen, the text, and why someone stops scrolling.
   - **Beats** — timestamped structure, using `cuts` for pacing (cuts per 10s).
   - **On-screen text** — size, position, how long each line stays readable.
   - **Audio** — voice, music, SFX, and where the beat drops.
   - **Payoff and CTA** — how it ends and whether it loops.
   - **Style** — palette (hex), type (family, weight, size against the frame), composition (grid,
     margins, where the subject sits), motion (easing, speed, and how each kind of object moves),
     and texture (grain, blur, shadow). Specific enough to recreate the look without the footage.
   - **Transferable** — what to reuse for the user's app, and what must not be copied (their
     footage, their audio unless licensed, their branding).
3. Propose a format, or update one with `save_format`, only after the user agrees on the angle.

## Produce items

1. `get_format`, then read its `README.md`, the `SKILL.md` of each skill it names, and the files of
   the choices you pick. If `check_format` says it is not ready, fix that first or tell the user.
2. `create_item` with `format`, `reference`, and `inputs`; ask the user for required inputs that have
   no default.
3. Write `brief.md` in the item folder: the one sentence a viewer should remember, who it is for,
   duration and aspects, the real assets you will use with their paths (captures, logo, footage),
   and what to keep or avoid. Never invent screens, numbers, reviews, or quotes. If an asset you
   need is missing, stop and ask for it.
4. Write `shotlist.md`: one line per beat with its start time, what is on screen, how it enters and
   leaves, and why it is there. Cut a beat you cannot justify. The hook comes first, and the first
   2–3 seconds must be understandable without sound. Give each kind of object (text, app captures,
   backgrounds) one way of moving, and put the sound beats on the same timeline so cuts land on
   them. Each aspect is its own composition, not a crop of another.
5. Show the user the brief and shot list in a few lines and wait for their okay before you render,
   unless they asked you to go ahead without checking.
6. Build media with the format's `render` command or template. Name files with the aspect prefix:
   `[9x16] video.mp4`, `[9x16] cover.jpg`, `[3x4] 01-cover.jpg`. One message per slide or scene.
7. Masters must be clean: no platform watermarks or UI. Every MP4 needs an AAC track whose start
   and duration match the video; pad with silence if needed.
8. `verify_item`, then fix every failed check. Then call `review_media` for each video and open the
   sheet and strips it returns; open images at phone size. Check that:
   - every line of text is readable at phone size and inside the safe zone (roughly the top 12% and
     bottom 20% of 9:16 frames are covered by platform UI);
   - only real assets appear, and type and color stay consistent with the brief;
   - no frame catches a transition half done in a way that looks broken;
   - cuts land on the sound beats, and the hook reads in the first 2 seconds;
   - the last frame works on its own as a poster.

   Name the three largest defects, each with its time, what you see, and a local fix. Fix only
   those, render, and review again. Stop when nothing above fails or after three rounds, and tell
   the user what is left.

9. Write copy with `update_item`: base `caption` plus per-platform `platforms.<p>` fields. Put the
   product CTA where the product rules say (first comment or after the caption body). Product claims
   must be accurate.
10. Set status to `review`. The user reviews on the board, where the brief and shot list show next
    to the media.

## Import a template from a link

The user shares a post, a repo, or a skill and asks to use it here. Turn it into a format, so the
board can list it, check it, and make items with it.

When the board runs the import, it decides when you may install: you can only read until the user
presses Allow there. Follow the board's messages about where to install and what is left to the
user.

1. Read the link and what it points to: the post, the repo's README, the skill's `SKILL.md`, and the
   license. If you cannot read it, say so and ask for the content; do not guess.
2. Map it onto the format: a structure (hook, beats, pacing) goes into `hookRules`, `structure`, and
   `checklist`; a set of styles or prompts becomes an input with one choice per style and the
   prompt in that choice's `files`; a tool or skill goes into `skills`, `requires`, and `render`.
   If it makes something other than video or images (a web page, a sketch, a 3D scene), say in the
   README how a clip is captured from it, and add what that needs to `requires`.
   A link with several templates (a pack or a kit) is one format when they differ only in look, with
   a choice per look, and one format each when they differ in structure, aspects, or tools. Install
   a skill they share once and list it in each format's `skills`.
3. List every skill, package, and program it needs, where each comes from, what it is for, and its
   license, and ask the user before installing any of them. Install only what they agree to, and
   show an install script before running it. Install skills in the workspace under
   `.agents/skills/<name>/`. When the board runs the import it copies each new skill to
   `.claude/skills/<name>/`; otherwise put a copy there too. Copy files byte for byte with
   `git clone`, or `curl` on the raw URL, rather than an installer such as `npx skills add`; a fetch
   tool that summarizes pages is for reading, and a summary is never a copy. If you have no way to
   copy them, say so and ask the user.
4. `save_format` with `title`, `summary`, `aspects`, `duration`, `requireAudio`, `skills` (name and
   source), `requires` (program names only), `tools` (the narrowest Claude Code permissions the
   skill needs, such as `Bash(uv:*)`), `inputs`, and `source` (`url`, `author`, `license`). Keep
   anything else under `metadata`; other unknown keys are dropped.
5. In the folder it returns, write `README.md` (how to make one item, step by step, for an agent that
   has never seen the link), the choice files, and previews. Make previews with the template itself
   or use ones the author licensed for reuse. If you copy code into `template/`, keep its LICENSE.
6. `check_format` and fix every problem it lists, until `ready` is true. If one cannot be fixed (a
   program the user declined, an account they have to create), leave it listed and say why.
7. Tell the user what the template makes, what you installed, and its license, and offer to make a
   first item.

Never write API keys or tokens into the format; they stay in the user's environment.

## Handle feedback

`list_open_feedback` → fix each comment (timecodes are seconds into the named media file) →
`verify_item` and `review_media` again → `resolve_feedback` with a one-line description of what changed. Do not mark
an item `approved`; only the user approves. Requests with `waiting` set, or a `run` still running,
belong to the board's agent, which takes them in turn; leave them unless the user asks.

Edit requests from the board's chat point at a part of one media file: a range (`timecode` to
`end`, in seconds), a box on a frame (`region`, fractions of the frame), or both. Their `context`
holds the files to look at, relative to the item folder: `clip.mp4` (the range), `frame.png` (the
frame, with the box drawn in red), and `before.*` (the media as it was). Open the frame before you
change anything. Write the result over the same media file name and never touch `before.*`; the
user compares the two and keeps or rolls back the edit. Change only the selected part unless the
request says otherwise, and end with a plain summary for someone who does not use video editors.

## Scheduling and metrics

- Never schedule, publish, or delete posts unless the user explicitly asks. When they do, use their
  scheduler (for example Postiz), then record the result with `set_schedule` (ISO time with offset,
  status, external id).
- Record metrics only from observed numbers or the user's report (`record_metrics`). Never invent
  numbers. Compare items that share a format to suggest the next variant.

## Rights

Record the provenance of music, footage, and fonts in the item's `notes`. Audio that is cleared to
use inside a platform is not necessarily licensed for embedding in an uploaded file.
