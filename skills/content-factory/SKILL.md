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

## Model

- **Reference** (`references/<id>/`): a video the user wants to learn from. Preprocessing produces
  `preprocess.json` (scene cuts, sampled frames, contact sheet, audio, optional transcript).
- **Format** (`formats/<id>/format.yaml`): a reusable recipe distilled from references — aspects,
  duration range, hook rules, beat structure, checklist, and optional `render` command plus
  `template/` code.
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

1. `create_item` with `format` and `reference`; write the hook first. The first 2–3 seconds must be
   understandable without sound.
2. Build media with the format's `render` command or template. Name files with the aspect prefix:
   `[9x16] video.mp4`, `[9x16] cover.jpg`, `[3x4] 01-cover.jpg`. One message per slide or scene.
3. Masters must be clean: no platform watermarks or UI. Every MP4 needs an AAC track whose start
   and duration match the video; pad with silence if needed.
4. `verify_item`, then fix every failed check. Look at representative frames yourself (first frame,
   middle, ending, cover at thumbnail size). Keep text inside the safe zone: roughly the top 12% and
   bottom 20% of 9:16 frames are covered by platform UI.
5. Write copy with `update_item`: base `caption` plus per-platform `platforms.<p>` fields. Put the
   product CTA where the product rules say (first comment or after the caption body). Product claims
   must be accurate.
6. Set status to `review`. The user reviews on the board.

## Handle feedback

`list_open_feedback` → fix each comment (timecodes are seconds into the named media file) →
`verify_item` again → `resolve_feedback` with a one-line description of what changed. Do not mark
an item `approved`; only the user approves.

## Scheduling and metrics

- Never schedule, publish, or delete posts unless the user explicitly asks. When they do, use their
  scheduler (for example Postiz), then record the result with `set_schedule` (ISO time with offset,
  status, external id).
- Record metrics only from observed numbers or the user's report (`record_metrics`). Never invent
  numbers. Compare items that share a format to suggest the next variant.

## Rights

Record the provenance of music, footage, and fonts in the item's `notes`. Audio that is cleared to
use inside a platform is not necessarily licensed for embedding in an uploaded file.
