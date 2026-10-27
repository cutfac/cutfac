# Onboarding

The first launch of the Mac app takes someone from a fresh install to a board that is ready for
their first video, in a few steps inside the app's own window.

## Ready means

Making a video on the board takes a request and an agent to run it; a template is optional. So
the app is ready when:

1. an agent CLI (Claude Code or Codex) is installed, recent enough and signed in,
2. a workspace folder exists, with that agent connected to it, and
3. the workspace has the brief and the material the user gave, for the agent to read first.

## What it replaced

- With no saved workspace, the app opened the system folder dialog before any window, and
  cancelling it quit the app.
- Once a folder was picked, the board opened on Setup, which listed the agents with a Connect
  button; one that was missing got a badge and no way forward.
- A new workspace had no templates, and nothing asked for one. The user had to find the Templates
  view and a link on their own.

## Steps

The user says what they want to make first, and the setup after it is for making that: the agent,
the permissions it works under, and where everything is kept. Each step checks what is already true
and passes on its own when it is: a second Mac, a reinstall or a workspace that already has
templates goes straight to what is missing. Closing the window keeps the progress. Steps 1 to 5
save the step the user is on, and the next launch opens on it. Once the workspace is made, the
board saves the answers into it and opens: nothing is made yet, so nothing is waited on.

| Step            | Shows                                                                                                                                                                                                                                              | Done when                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1. Welcome      | What Cutfac does in one sentence, Start, and the language                                                                                                                                                                                          | Start is pressed                        |
| 2. What to make | What the user does, a website and a folder to read, where the videos go, then anything else, a part at a time. The app keeps the answers until there is a workspace                                                                                | Next is pressed on the last part        |
| 3. Agent        | Claude Code and Codex as found on this Mac: ready, needs an update, needs a sign-in, or missing, each with a button that fixes it                                                                                                                  | One agent is ready, and Next is pressed |
| 4. Permissions  | Screen Recording and Accessibility, what each lets the agents do, and Turn on for each. A panel under System Settings is the app to drag into the list                                                                                             | Both are on, or Skip                    |
| 5. Ready        | Where everything is kept, as one line (`~/Documents/Cutfac`) with Change, whether to share error reports and usage statistics with the Cutfac team, each on its own, and Start making. The folder is made and the agents from step 3 connect to it | The board opens on the folder           |

### Before the workspace

Steps 1 to 5 run before there is a workspace, so before there is a server. Electron serves the
built board on its own `cutfac://` scheme, which keeps storage and fetch as a web origin does, and
answers those steps itself over the preload bridge. Agent detection runs as a CLI command that
needs no workspace (`cutfac agents --json`), so the server and Electron share one implementation.
What to make has nowhere to be saved yet, so the app keeps the answers in its settings, where they
last through the relaunch screen recording asks for. Step 5 starts the server on the folder; the
board then forgets the answers, saves the brief and learns the material, which takes seconds, and
opens. A browser has no steps before the workspace, so it asks what to make on Start.

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
server entry per workspace. So step 3 only checks, and step 5 connects every agent that is ready,
as the Connect button does today.

### Permissions

The agents Cutfac runs act under its permissions: macOS holds what they do to the app that started
them. The step asks for the two they use from the first video on, each with Turn on:

- **Screen Recording**, so they can record the user's screen and apps as footage.
- **Accessibility**, so they can click and type in other apps when the user asks, as Claude Code's
  and Codex's computer use do. macOS 27 calls it Device Control and Data Access and widens it, and
  the step names it so there.

Both are granted only by adding the app to a list in System Settings. Apps like Codex make that one
motion, after [PermissionFlow](https://github.com/jaywcjlove/PermissionFlow):

1. The step shows a picture of System Settings with the panel under it, and a pointer dragging the
   app into the list the user is on, or the next one to turn on.
2. Turn on opens the pane (`x-apple.systempreferences:` with `Privacy_ScreenCapture` or
   `Privacy_Accessibility`).
3. A small panel sits under the Settings window, lined up with the list, and follows the window as
   it moves. It is one card with Cutfac's icon and name; dragging it drags the app bundle itself
   (`webContents.startDrag` with the `.app` path), which is what the list accepts. The user never
   hunts for the app with +.
4. Accessibility shows as soon as it is on (`isTrustedAccessibilityClient`). macOS reads screen
   recording once per process (`getMediaAccessStatus`), so that grant shows only after the app
   reopens. macOS offers that itself once it is on, and the app opens again on this step, with the
   answers from step 2 kept, and finds it then.

Once both are on, the step moves on by itself. It can be skipped; macOS then asks the first time an
agent needs either.

Cutfac doesn't ask for Full Disk Access, which would let every agent read the user's mail and
messages too: reading Desktop, Documents, Downloads and the like, macOS asks once per folder the
first time an agent reaches one, and remembers the answer. Notifications are offered on the empty
board, before the first video, since they help once an agent works: macOS asks on the app's first notification and
Electron has no other way to ask, so Turn on puts up a sample one. A dev build signs differently
from the release, so it gets its own entry in each list.

### What to make

A template is the folder that lets an agent make one kind of video the same way every time: the
spec, the skills, the render code and the choices (see `templates.md`). People don't write one, and
don't need the word. They say what they want to make and point at what they like, and the agent
writes the template from that. So step 2 asks, a part at a time and in this order, for:

- **Purpose**: promoting the user's own product or service, information and tips, a personal
  brand, or their own words.
- **Their material**, optional: website links, or local folders to read from (a brand kit, past
  videos, a product folder). A website and a folder are each a part of their own, so each screen
  asks for one thing; the browser, which can't pick a folder, asks for the website alone. Start
  learns each one into the workspace with the Learn the board already has, into `about.md`, so every
  later run reads it too. A folder is read where it is, not copied.
- **Platforms**: TikTok, YouTube Shorts, Instagram Reels, any of them, each with its logo, or Other
  for somewhere the list doesn't name, which the next part lets the user say. They set the aspect
  ratios and lengths.
- **Anything else**, last and optional: a line or two in the user's own words, for what the choices
  left out. For their own purpose it is required, since it is all the brief says.
- **A reference**, optional: one card from a gallery of public examples (skills, starter kits,
  finished projects and collections of videos with their prompts), or another link pasted in.

Nothing is made from it during the first launch. A template took the agent minutes, and what came
out was a spec for the agent that the user couldn't judge yet. Instead the answers are context:
`brief.md` and the material in `about.md`, which the agent reads before every template and video.
The first video is asked for on the board in the user's own words, with or without a template, and
a template can come from a video the user likes later, through Templates. A learned source marks its
section in `about.md` as not read yet, so the first agent that works reads it and rewrites it.

### The brief

The purpose, platforms and the user's own words are saved as `brief.md` at the workspace root, so
each workspace has its own: one for promoting an app and one for a personal brand keep separate
briefs, as they keep separate templates. A new workspace asks for its brief with the same form as
step 2. Every later agent run and the MCP tools read it, so the next template and every video start
from the same context. The front matter holds what the app reads, the body is the user's own words:

```markdown
---
purpose: promote
platforms: [tiktok, shorts]
---

Short videos that promote my app. Light and friendly.
```

The person and the agent edit the same file:

- **On the board**, the top of the sidebar, under the workspace name, sums the brief up in a line
  ("Promote my app · TikTok, Shorts"). Clicking it opens a sheet with the step 2 form: purpose and
  platforms to pick, and the body as free text. Saving writes `brief.md`. No menu item or settings
  page of its own. Material isn't part of it; it lives in `about.md`, as anything learned does.
- **In words**, the user tells the agent while working ("I'm doing Reels now too"), and the agent
  updates `brief.md` through the `update_brief` MCP tool and says what changed in one line. The
  sheet shows the change at once.

The gallery is a list of links, each with a title, a line on what it is and its license. It lists
only references with a license that allows reuse; a link pasted in is the user's call. For now the
list is built into the app. It is to move to cutfac.com, which the app fetches, so it grows without
a release, and each entry is to gain a preview clip: a short cut of the reference's own demo, hosted
with the source and license beside it, so the gallery doesn't break when a repository moves its
files.

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

### The board after

The board opens empty, on New video, with what the agent already knows: a line naming the learned
material, which opens the Brief page with `about.md` as the agent reads it, and Turn on for
notifications.

### Agents see the same state

The checks behind each step are also the workspace state that the MCP tools report: no template
yet, a template that is incomplete and why. An agent the user talks to outside the app finds out
what is missing, and how to fix it, from the tools it already calls.

### Out of scope

- The license key stays in the menu. The free plan reaches the first video without one.
- No path for upgrading users: there are none yet with a workspace to carry over.
