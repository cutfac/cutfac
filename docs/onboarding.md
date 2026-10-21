# Onboarding

Draft. The first launch of the Mac app takes someone from a fresh install to a board that is ready
for their first video, in a few steps inside the app's own window.

## Ready means

Making a video on the board takes a title and a template, and an agent to run it. So the app is
ready when:

1. an agent CLI (Claude Code or Codex) is installed, recent enough and signed in,
2. a workspace folder exists, with that agent connected to it, and
3. the workspace has at least one template that is ready to use.

## Today

- With no saved workspace, the app opens the system folder dialog before any window, with one line
  of text. Cancelling it quits the app.
- Once a folder is picked, the board opens on Setup when no agent is connected. Setup lists the
  agents with a Connect button; one that is missing gets a badge and no way forward.
- A new workspace has no templates, and nothing in setup asks for one. The board's empty state
  names templates, but the user has to find the Templates view and a link on their own.

## Steps

Each step checks what is already true and passes on its own when it is: a second Mac, a reinstall
or a workspace that already has templates goes straight to what is missing. Closing the window
keeps the progress; the next launch opens on the same step.

| Step            | Shows                                                                                                                                                                                                                   | Done when                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1. Welcome      | What Cutfac does in one sentence, and Start                                                                                                                                                                             | Start is pressed                  |
| 2. Agent        | Claude Code and Codex as found on this Mac: ready, needs an update, needs a sign-in, or missing, each with a button that fixes it                                                                                       | One agent is ready                |
| 3. Permissions  | Why the app needs file access, and Open System Settings. A small window floats next to Settings with Cutfac's icon to drag into the list                                                                                | macOS reports the access granted  |
| 4. Workspace    | A folder already filled in (`~/Documents/Cutfac`) with Create, and Choose another folder. The agents from step 2 connect to it without a separate button                                                                | The server runs on the folder     |
| 5. What to make | What the videos are for and where they go, the user's own material (a website, a local folder), and a gallery of references to start from. Start has the agent make a template from them and moves on to step 6 at once | Start is pressed                  |
| 6. First video  | The template run's progress, and a title field. Allow shows here when the import needs it                                                                                                                               | The item exists; its detail opens |

### Before the workspace

Steps 1 to 3 run before there is a workspace, so before there is a server. Electron loads the built
board without one and answers those steps itself over the preload bridge. Agent detection runs as a
CLI command that needs no workspace (`cutfac agents --json`), so the server and Electron share one
implementation. From step 4 on the app works as it does today: the server starts on the folder and
the board talks to it.

### Agent

The agent decides whether anything else can work, so it is checked before the user creates
anything. Detection needs no workspace:

- installed and version: the binary on the user's shell `PATH`, as today;
- signed in: `claude auth status --json` (`loggedIn`) and `codex login status`, neither of which
  calls a model.

Fixing is a button, not a command to copy, since the people Cutfac is for find a terminal
uncomfortable:

- Install runs the agent's official installer and shows its progress.
- Sign in runs `claude auth login` or `codex login`, which opens the browser. The step checks again
  on its own and turns ready when the sign-in lands.
- Update runs the agent's own update command.
- When one of them fails, the step shows the command to run in a terminal, with Copy and Check
  again.

With neither agent on the Mac, Claude Code is the one offered first, and Codex sits below it as the
alternative. One line says that either needs its own subscription, and to pick the one the user
already pays for.

Connecting needs the workspace: Claude Code reads the workspace's `.mcp.json`, and Codex gets a
server entry per workspace. So step 2 only checks, and step 4 connects every agent that is ready,
as the Connect button does today.

### Permissions

macOS doesn't let an app ask for some access in a dialog: Full Disk Access (and Accessibility, Screen
Recording) is granted only by adding the app in System Settings. Apps like Codex make that one
motion:

1. The step says, in a sentence, what the access is for: the agents Cutfac runs read the files the
   user points them at, a video in Downloads or a project on the Desktop, and without it macOS stops
   each one with its own prompt, attributed to Cutfac.
2. Open System Settings goes straight to the pane (`x-apple.systempreferences:` with
   `Privacy_AllFiles`).
3. A small frameless window appears beside the Settings window, with Cutfac's icon and "Drag
   Cutfac into the list". Dragging the icon drags the app bundle itself (`webContents.startDrag`
   with the `.app` path), which is what the list accepts. The user never hunts for the app with +.
4. Cutfac checks the access every second by reading a file only Full Disk Access opens. When it
   reads, the helper window closes, Cutfac comes back to the front, and the step shows a check and
   moves on. Nothing to confirm.

It comes right after the agent and before the workspace, so nothing reads the user's files before
the access is settled. The step can be skipped. Without it, macOS asks per folder the first time an
agent reaches one, which works, only with more prompts. A dev build signs differently from the
release, so it gets its own entry in the list.

### What to make

A template is the folder that lets an agent make one kind of video the same way every time: the
spec, the skills, the render code and the choices (see `templates.md`). People don't write one, and
don't need the word. They say what they want to make and point at what they like, and the agent
writes the template from that. So step 5 asks for:

- **Purpose**: promoting the user's own product or service, information and tips, a personal
  brand, or their own words.
- **Platforms**: TikTok, YouTube Shorts, Instagram Reels, any of them. They set the aspect ratios and
  lengths.
- **Their material**, optional: a website link, or a local folder to read from (a brand kit, past
  videos, a product folder). The folder is read where it is, not copied.
- **A reference**, optional: one card from a gallery of public examples (skills, starter kits,
  finished projects and collections of videos with their prompts), or another link pasted in.

Start runs the agent on all of it through the import the Templates view already runs, with the
same consent rules; only the request changes, from "make this link usable here" to "make a
template for this person, starting from this reference". Without a reference the agent starts from
what it knows. The agent may ask when a guess would likely make the wrong thing, such as which
product on a website to promote; the question shows in step 6 next to the title, and the import
already takes replies. The request leans it toward deciding: ask only what it can't settle
reasonably, one question at a time so each is quick to answer, keep them few, and otherwise pick a
sensible default. That is guidance in the request, not a hard limit. What it settled without asking
goes in the template's README, where the user can change it.

The user never sees the request itself. In outline it says:

- make one template for the person `brief.md` describes, reading its material;
- start from this reference, or from what you know when there is none;
- fit the aspect ratios and lengths to the platforms;
- ask only what you can't settle reasonably, one question at a time, each with two or three likely
  answers to pick from; settle the rest with sensible defaults and list them in the README;
- finish when `check_format` passes;
- reply and ask in the user's language.

The wording is tuned against real agent runs when it is built.

### The brief

The purpose, platforms and material are saved as `brief.md` at the workspace root, so each workspace
has its own: one for promoting an app and one for a personal brand keep separate briefs, as they
keep separate templates. A new workspace asks for its brief with the same form as step 5. Every
later agent run and the MCP tools read it, so the next template and every video start from the same
context. The front matter holds what the app reads, the body is the user's own words:

```markdown
---
platforms: [tiktok, shorts]
material:
  - https://example.com
  - ~/Documents/Brand
---

Short videos that promote my app. Light and friendly.
```

The person and the agent edit the same file:

- **On the board**, the top of the sidebar, under the workspace name, sums the brief up in a line
  ("Promote my app · TikTok, Shorts"). Clicking it opens a sheet with the step 5 form: purpose and
  platforms to pick, material to add or remove, and the body as free text. Saving writes
  `brief.md`. No menu item or settings page of its own.
- **In words**, the user tells the agent while working ("I'm doing Reels now too"), and the agent
  updates `brief.md` through an MCP tool and says what changed in one line. The sheet shows the
  change at once.

The gallery is a list of links hosted on cutfac.com, which the app fetches, so it changes without a
release as new examples appear. Each entry carries a title, a preview clip, a link and its license.
It lists only references with a license that allows reuse; a link pasted in is the user's call. The
preview clips are short cuts of each reference's own demo, hosted on cutfac.com with the source and
license beside them, so the gallery doesn't break when a repository moves its files.

It starts with references that are ready to use as they are, not collections the agent would have
to search:

| Reference                                                                           | What it is                                                                     | License |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------- |
| [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)                 | A Claude Code skill with 51 film styles, each a prompt and a demo made in code | MIT     |
| [Vincentwei1021/mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15)       | 15 motion graphics styles, with prompts and source                             | MIT     |
| [JohnHeibel/ClaudeAnimationBase](https://github.com/JohnHeibel/ClaudeAnimationBase) | A starter kit for hand-painted cartoon animation                               | MIT     |
| [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)                       | A finished lyric music video, rendered locally                                 | MIT     |

The core stays domain-agnostic: the gallery and the brief are data, and nothing in the app knows a
niche.

### First video

A template can take the agent a few minutes, so the user doesn't wait on it. Start moves straight
to the title, with the run's progress above the field and its Allow, when it asks for one, in
place:

- **Progress** is one line that moves through the run: reading the reference, picking the style,
  checking.
- **A question** shows as one bubble above the title field, with the agent's suggested answers as
  buttons and a field for its own answer. Answering one brings the next or lets the run go on.
- **When it is done**, what the agent settled without asking shows as a short list ("30 seconds",
  "large captions"), the same as the README. Clicking one lets the user change it in words.

Create is ready once the title is in and the template is; it makes the item with
that template and opens its detail view. The agent doesn't start on its own: the first run is the
user's to start, from the detail view, as every later one is.

### Agents see the same state

The checks behind each step are also the workspace state that the MCP tools report: no template
yet, a template that is incomplete and why. An agent the user talks to outside the app finds out
what is missing, and how to fix it, from the tools it already calls.

### Out of scope

- The license key stays in the menu. The free plan reaches the first video without one.
- No path for upgrading users: there are none yet with a workspace to carry over.
