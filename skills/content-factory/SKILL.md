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
   - **Transferable** — what to reuse for the user's app, and what must not be copied (their
     footage, their audio unless licensed, their branding).
3. Propose a format, or update one with `save_format`, only after the user agrees on the angle.

## Produce items

1. `get_format`, then read its `README.md`, the `SKILL.md` of each skill it names, and the files of
   the choices you pick. If `check_format` says it is not ready, fix that first or tell the user.
2. `create_item` with `format`, `reference`, and `inputs`; ask the user for required inputs that have
   no default. Write the hook first. The first 2–3 seconds must be understandable without sound.
3. Build media with the format's `render` command or template. Name files with the aspect prefix:
   `[9x16] video.mp4`, `[9x16] cover.jpg`, `[3x4] 01-cover.jpg`. One message per slide or scene.
4. Masters must be clean: no platform watermarks or UI. Every MP4 needs an AAC track whose start
   and duration match the video; pad with silence if needed.
5. `verify_item`, then fix every failed check. Look at representative frames yourself (first frame,
   middle, ending, cover at thumbnail size). Keep text inside the safe zone: roughly the top 12% and
   bottom 20% of 9:16 frames are covered by platform UI.
6. Write copy with `update_item`: base `caption` plus per-platform `platforms.<p>` fields. Put the
   product CTA where the product rules say (first comment or after the caption body). Product claims
   must be accurate.
7. Set status to `review`. The user reviews on the board.

## Import a template from a link

The user shares a post, a repo, or a skill and asks to use it here. Turn it into a format, so the
board can list it, check it, and make items with it.

1. Read the link and what it points to: the post, the repo's README, the skill's `SKILL.md`, and the
   license. If you cannot read it, say so and ask for the content; do not guess.
2. Map it onto the format: a structure (hook, beats, pacing) goes into `hookRules`, `structure`, and
   `checklist`; a set of styles or prompts becomes an input with one choice per style and the
   prompt in that choice's `files`; a tool or skill goes into `skills`, `requires`, and `render`.
3. List every skill, package, and program it needs, where each comes from, what it is for, and its
   license, and ask the user before installing any of them. Install only what they agree to, and
   show an install script before running it. Install skills in the workspace under both
   `.agents/skills/<name>/` and `.claude/skills/<name>/`.
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
`verify_item` again → `resolve_feedback` with a one-line description of what changed. Do not mark
an item `approved`; only the user approves.

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
