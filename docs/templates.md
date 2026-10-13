# Templates

A template is a reusable way of making posts: a talking-head hook, a carousel layout, or a
generated art clip that comes with its own Agent Skill. The board calls them templates; the files,
the CLI and the MCP tools call them formats.

Content Factory does not import templates itself. It defines the folder a template lives in, and
`check_format` says what a template still lacks. Your agent does the rest: given a post, a repo or a
skill ("read this link and make it usable here"), it writes the folder, asks you before installing
anything, and runs `check_format` until the template is ready. The factory never downloads or
installs anything on its own.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../.github/assets/templates-dark.png">
  <img alt="The Templates page: a template's skill, source and license, and the styles an item can pick, each with a preview" src="../.github/assets/templates-light.png">
</picture>

## Folder

```
formats/<id>/
  format.yaml    the spec (required)
  README.md      how to make an item with it, written for the agent (optional)
  previews/      images or clips that show each choice (optional)
  styles/        files the agent reads for a choice; any folder name works (optional)
  template/      code that `render` runs (optional)
```

`<id>` is the folder name; `save_format` makes one from the title when it is not given. Every path
in `format.yaml` is relative to the template folder and may not leave it.

## format.yaml

Only `title` is required.

| Field | Default | Meaning |
| --- | --- | --- |
| `title` | | Name shown on the board |
| `summary` | `""` | One line on what the template makes |
| `references` | `[]` | Ids of the references it was distilled from |
| `aspects` | `[9x16]` | Any of `9x16`, `4x5`, `3x4`, `1x1`, `16x9` |
| `duration` | | `{ min, max }` in seconds |
| `fps` | | Frame rate the media should have |
| `requireAudio` | `true` | Whether every video needs an audio track |
| `hookRules` | `[]` | Rules for the first seconds |
| `structure` | `[]` | The beats, in order |
| `checklist` | `[]` | What to check before review |
| `render` | | Command that renders one item, run from the workspace root |
| `source` | | `{ url, author, license }`: where the template came from |
| `skills` | `[]` | Agent Skills the template is made with: `{ name, source }` |
| `requires` | `[]` | Programs that must be on `PATH`, by name only, such as `ffmpeg` |
| `tools` | `[]` | Extra tools Claude Code may use in board edits, such as `Bash(uv:*)` |
| `inputs` | `[]` | What to decide when an item is made (below) |
| `metadata` | | Anything else; Content Factory keeps it and never reads it |

### Inputs

An input is one decision per item, such as a style or a hook line.

| Field | Default | Meaning |
| --- | --- | --- |
| `id` | | Letters, digits, `-` and `_` |
| `title` | | Label in the new item dialog |
| `description` | | Help under the label |
| `choices` | `[]` | Options to pick from; without them the input is free text |
| `default` | | Used when the item gives no value; one of the choice ids, if there are choices |
| `required` | `false` | An item cannot be made without a value or a default |

A choice has an `id`, a `title`, an optional `summary`, an optional `preview` (an image or clip
that shows it) and `files` the agent reads when an item picks it, such as a style prompt.

The values an item was made with are stored in its `item.yaml` under `inputs`, with defaults filled
in. `create_item` rejects unknown inputs, values that are not one of the choices, and missing
required ones.

### Skills, programs and tools

- A skill is an [Agent Skill](https://agentskills.io) folder with a `SKILL.md`. The check looks for
  it in the workspace at `.agents/skills/<name>/` (Codex) and `.claude/skills/<name>/` (Claude
  Code). Install it in both so either agent finds it. `name` is the folder name, lowercase words
  joined by hyphens; `source` says where to get it.
- `requires` lists programs the template runs. The check only looks them up on `PATH`.
- `tools` is added to Claude Code's allowed tools when the board asks an agent to edit an item of
  this template. Codex runs ignore it.

When the board sends an edit request, the prompt points the agent at the template's `format.yaml`,
`README.md`, the `SKILL.md` of each skill, and the files of each choice the item picked. If the
template is not ready, the agent is told to stop and say what is missing rather than work around
it.

### Extending

Keys the spec does not know are dropped when the template is saved. Put your own under `metadata`,
for example `metadata: { model: flux-dev, seed: 7 }`, and read them from your skill or `render`
command. New fields that more than one template needs belong in the spec instead; open an issue.

## Checking

`check_format` (MCP), `GET /api/formats/status` (HTTP) and the Templates page all report the same
problems:

| Kind | Meaning |
| --- | --- |
| `spec` | `format.yaml` does not read, or a value cannot work: a bad id, a default that is not a choice, a path outside the folder, `duration.min` above `max` |
| `skill` | A skill is in neither skill folder |
| `program` | A program is not on `PATH` |
| `file` | A preview or choice file is missing |

A template is ready when there are no problems. The board still lists templates that are not
ready, with a prompt to copy for your agent to finish them.

## Example

A template built around a third-party skill that animates still artwork:

```yaml
title: Art motion
summary: Still artwork brought to life with a generated camera move.
aspects: [16x9, 9x16]
duration: { min: 6, max: 12 }
requireAudio: false
source:
  url: https://example.com/art-motion
  author: Example Studio
  license: MIT
skills:
  - name: art-motion
    source: https://github.com/example/art-motion
requires: [uv, ffmpeg]
tools: ["Bash(uv:*)", "Bash(ffmpeg:*)"]
inputs:
  - id: style
    title: Style
    required: true
    choices:
      - id: ink
        title: Ink wash
        preview: previews/ink.png
        files: [styles/ink.md]
      - id: neon
        title: Neon
        preview: previews/neon.mp4
        files: [styles/neon.md]
  - id: subject
    title: Subject
    description: What the artwork shows.
checklist:
  - The motion never warps the subject's face or hands.
metadata:
  model: example-motion-v2
```

## Rendering

`render` and the code in `template/` are up to the template. Agents review and fix the result one
frame at a time, so a template works best when each frame depends only on what it is told:

- **Seekable.** Any frame renders on its own, without playing the ones before it. `review_media`
  and board edits look at single frames and short ranges.
- **No hidden clock.** Motion follows the frame's time, not wall-clock time, timers or what an
  earlier frame left behind.
- **Seeded.** Anything random takes a seed from the item's inputs, so a rerender looks the same.
- **Everything on disk.** A frame is a function of its time, the item's shot list, its assets, the
  template's style and the seed. Nothing else changes the picture.

Then a fix in one beat changes only that beat, and the agent can check it by rendering a frame.

## Style

A template with a look keeps it in files the agent reads, such as `styles/<choice>.md` for each
choice or the README for one look:

- the palette as hex values, and what each color is for;
- type: families, weights, and sizes as a share of the frame height;
- motion: easing and duration for each kind of object (text, app captures, backgrounds), and what
  never moves;
- the generic defaults it must not fall back on, such as a stock font or a centered title that
  fades in.

Put the checks that follow from the style in `checklist`; the agent goes through them when it
reviews the frames.

## Bringing one in from a link

The Templates page has "Add template", which turns a link into a prompt for your agent. The steps
the agent follows are in the workspace's `content-factory` skill under "Import a template from a
link". In short:

1. Read the link and decide what kind of template it is.
2. List every skill, package and program it needs and what each is for, and install them only after
   you agree. Files are copied as they are, never retyped from a summary.
3. Call `save_format`, then write the README, previews and choice files into the folder it returns.
4. Call `check_format` and fix what it lists until the template is ready.

A link can hold several templates, such as a pack of styles or a kit of layouts. Variants that
share a structure and differ only in look become one template with a choice per look; ones that
differ in structure, aspects or tools become one template each. A skill they share is installed
once and listed in each template's `skills`, and each template's `source` points at the same link.

## Rights

Record where a template came from in `source`, and keep its license. A license on a skill or prompt
does not cover the example media in the post that shared it: make previews with the template
itself, or use ones the author licensed for reuse. The rules for footage, music and fonts in items
still apply.
