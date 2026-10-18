---
name: cutfac
description: Work inside a Cutfac workspace — learn the user's product and the short-form videos they like, turn them into reusable formats, produce short-form items (9:16 video, carousels) that market the user's app, handle review feedback from the web board, and verify uploads. Use whenever the user mentions learning, references, formats, items, the board, feedback, or short-form content for their app.
---

# Cutfac

The workspace is the source of truth. Everything lives on the user's machine as folders and YAML;
the `cutfac` MCP tools read and write the same files, and the user watches results in the
local web board (`cutfac serve`). Use the MCP tools for structured fields; write media directly
into folders.

## Start of every task

1. `workspace_overview` — config, what was learned, item counts, formats, open feedback.
2. Read `about.md` (its path is in `workspace_overview`) when it exists: what the user taught the
   workspace about their product, audience, and voice. A section marked `> Not read yet` was only
   scraped; read its source and rewrite it before you rely on it (see Learn). Never invent product
   features or UI; only show screens and footage the user provided or pointed you at.
3. If there is open feedback, ask whether to handle it first (`list_open_feedback`).
4. If nothing was learned about the product yet, ask for a website, App Store, or Google Play link,
   or the folder they work in, and `learn` it. Then agree on the audience and voice with the user
   and write them into `about.md`. Store screenshots are marketing images, not screens to show as
   the app.

## Model

- **Learned** (`learned/<id>/`): a link, file, or folder the user taught the workspace, with what a
  first look saved from it. Its section in `about.md` is what agents read. A video also gets
  `preprocess.json` (scene cuts, sampled frames, contact sheet, audio, optional transcript).
- **Format** (`formats/<id>/format.yaml`, a "template" on the board): a reusable recipe — aspects,
  duration range, hook rules, beat structure, checklist, the skills and programs it is made with,
  the inputs decided per item (such as a style), and an optional `render` command plus `template/`
  code. It is distilled from videos the user likes or brought in from a link.
- **Item** (`items/<id>/item.yaml` + media): one publishable post. Status flows
  `drafting → review → done` (or `archived`). Its `sources` are
  folders, files, and web pages the user wants you to read whenever you work on it: read what helps
  before you write or change anything, and never change them. When the user points you at one to
  build on, add it with `update_item` (`sources` replaces the whole list). A folder of content
  without `item.yaml` is not on the board; `create_item` with its `id` brings it in as is.

## Learn

When the user shares something to learn from (a landing page, a store listing, a video they like,
or a file or folder on their computer), call `learn` with it. It saves a first look into
`learned/<id>/` (title, description, icon, and pictures; for a video also the video, frames, and a
contact sheet) and adds a section to `about.md` marked `> Not read yet`. Then:

1. Read the source more deeply: the page, the folder's README and code, or the video's contact
   sheet, hook frames, and transcript.
2. Rewrite its section with what matters for the videos: what it is, who it is for, the words they
   use, and proof points; for a video, what to borrow (hook, pacing, style) and what must not be
   copied. Keep it short and factual, since the user edits this file too.
3. Keep the `<!-- learned:<id> -->` line and delete the `> Not read yet` line.

## Study a video

1. In its `learned/<id>/` folder, open `contact.jpg` and the hook frames (`frames/t000.0.jpg` …
   `t003.0.jpg`). Read the transcript if present, or transcribe `audio.wav` yourself if you can.
2. Write `analysis.md` in that folder, using these sections, and keep its section in `about.md` to
   a few lines that point to it:
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
2. `create_item` with `format` and `inputs`; ask the user for required inputs that have no default.
   Add the learned folders it builds on, such as a video it follows, to the item's `sources`.
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
8. `verify_item`, then fix every failed check. Then call `review_media` for each video, open the
   sheet and strips it returns, and go through the checklist it returns; open images at phone size.
   For each frame, name what it is meant to show before you judge it. Check that:
   - every line of text is readable at phone size and nothing covers it (a band, a box, another
     layer);
   - text and the subject stay out of the safe zone: on 9:16 frames `review_media` dims the top 12%
     and bottom 20%, which platform UI covers;
   - each line of text stays up long enough to read twice;
   - only real assets appear, and type and color stay consistent with the brief;
   - no frame catches a transition half done in a way that looks broken;
   - cuts land on the sound beats, and the hook reads in the first 2 seconds;
   - the last frame works on its own as a poster.

   Name the three largest defects, each with its time, what you see, and a local fix. Fix only
   those, render, and review again. Stop when nothing above fails or after three rounds, and tell
   the user what is left.

9. Put the post copy, the caption and the CTA in the item's `notes` with `update_item`, following
   what `about.md` says about the voice and the call to action. Product claims must be accurate.
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
`verify_item`, and `review_media` with `times` in the changed part → `resolve_feedback` with a
one-line description of what changed. Do not mark an item `done` or `archived`; only the user does.
Requests with `waiting` set, or a `run` still running, belong to the board's agent, which takes them
in turn; leave them unless the user asks.

Edit requests from the board's chat point at a part of one media file: a range (`timecode` to
`end`, in seconds), a box on a frame (`region`, fractions of the frame), or both. Their `context`
holds the files to look at, relative to the item folder: `clip.mp4` (the range), `frame.png` (the
frame, with the box drawn in red), and `before.*` (the media as it was). Open the frame before you
change anything. Write the result over the same media file name and never touch `before.*`; the
user compares the two and keeps or rolls back the edit. Change only the selected part unless the
request says otherwise, and end with a plain summary for someone who does not use video editors.

## Rights

Record the provenance of music, footage, and fonts in the item's `notes`. Audio that is cleared to
use inside a platform is not necessarily licensed for embedding in an uploaded file.
