# Desktop app

```sh
bun run desktop           # build the web UI and Electron shell, then open it
bun run dist:desktop      # unsigned macOS app in release/, with the server compiled as a sidecar
bun run release           # signed, notarized and uploaded release, tagged on GitHub (see Releasing the app)
```

The app runs the same server as `cutfac serve` as a sidecar on `127.0.0.1` and opens the board in
its window.

## Updates

The released app checks its feed at launch and every four hours, downloads a newer version in the
background, and offers to restart once it is ready. Choosing Later installs it the next time the app
quits. The app menu also has Check for Updates… and License Key….

The feed is served by cutfac.com and needs no license key, so the free version updates too. The
license key from checkout unlocks the paid plan: the app keeps it in its settings and asks
cutfac.com at launch and once a day whether its plan is active. Without an active plan, or offline
for more than a week, the app is the free version again. Runs from source (`desktop`,
`desktop:dev`) never update.

## Releasing the app

One command ships a release, from a clean `main`:

```sh
bun run release          # release the version in package.json
bun run release patch    # or minor, major, or a version: bump it with `bun pm version` first
```

It reads its credentials from `.env.release`, which git ignores:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` to notarize
- `CUTFAC_RELEASES_BUCKET`, `CUTFAC_RELEASES_REGION` for the private S3 bucket the builds go to
- `CUTFAC_POSTHOG_KEY`, the project token of the PostHog project error reports go to, which the
  build writes into the app (see Error reports and usage statistics)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` for a user that can read and write `mac/` in it

Give that user only `s3:PutObject`, `s3:GetObject` and `s3:AbortMultipartUpload` on the bucket's
objects and `s3:ListBucket` on the bucket, which lets the first release see that no feed exists yet.
It never deletes or changes bucket settings. The site holds no AWS key: it signs CloudFront links,
and only that distribution may read the bucket.

Before the long build, the script checks in seconds that every variable is set, the keychain has a
Developer ID Application certificate for `APPLE_TEAM_ID`, `gh` is logged in, and `main` has no
uncommitted changes a build would pick up and isn't behind `origin/main`. It lists everything to fix
at once. It then refuses a version that is already tagged or not newer than the published one, and
runs the checks CI runs. A bump is committed as `chore(release): <version>` only once they pass;
until then a failure puts `package.json` back.

Then it builds, signs under the hardened runtime, notarizes, and uploads the dmg, the zip and their
blockmaps to `mac/`, then `latest-mac.yml` last so no app sees the release before its files.
cutfac.com hands out short-lived CloudFront links to these files: the dmg from its download page and
the rest to the app's update checks. The feed is never cached and build files never change, so a
release needs no cache invalidation.

Last, it tags the commit it built `v<version>`, pushes `main` and the tag together, and creates a
GitHub release with no files attached, whose notes list the features and fixes since the last tag.
If that step fails, the builds are already out and the script prints the commands left to run.
It ends by reminding you to add the version to cutfac.com's changelog, which is written by hand
from those notes.

The feed is the `publish` url in `electron-builder.yml`, and every build keeps the URL it was built
with. To move the feed, publish one release that points to the new place while the old one keeps
serving.

To sign and ship your own build, put your own Apple account, bucket and key in `.env.release` and
point the `publish` url at a feed you serve. The app fetches `latest-mac.yml` from that url, with
the files it names next to it, and sends no license key with them.
`dist:desktop` builds stay unsigned and need none of this.

## Feedback

People can tell the Cutfac team something three ways: "Send feedback" in the sidebar, a message
that starts with `/feedback` in the editor's message box, the box prompt or the import chat (it goes
to the team, not the agent), or by asking their agent, which calls the `send_feedback_to_cutfac` MCP
tool. Agents that list MCP prompts as commands also offer the `feedback` prompt,
`/mcp__cutfac__feedback` in Claude Code, which takes the message after it or asks for one. The
agent shows them the exact text and sends it only once they agree. The board posts to
`/api/team-feedback`; the MCP tool sends from the MCP server itself. Either way
`https://cutfac.com/api/feedback` gets the message, an optional reply address, the app's version,
platform and language, which way it came, and the agent, if one was involved.

In the desktop app, feedback can also carry the app's recent log (see Logs): the newest days, up to
1 MB, gzipped as `cutfac-logs.txt.gz`, which cutfac.com attaches to the mail. With a log to send,
"Send feedback" ends with two buttons, "Send with log" and "Send without log", and picks neither;
Enter sends without it. Above them it says what the log holds, shows it on request, and says how
many errors it has had lately. Without a log there is one "Send". The agent asks first and passes
`logs: true` only if the person agrees. A `/feedback` message sends no log. Feedback sent with its
log, while the person sends error reports, also carries the install ID, so the team can find that
install's reports; other feedback never does. Nothing else is sent.

## Logs

The desktop app keeps a log of its own in `~/Library/Logs/Cutfac`, or `Cutfac Dev` for the dev
build, a file per process and day: `app-` for Electron's main process, `server-` for the board's
server, `mcp-` for the agent tools. Each line is JSON: what the app logged at info level and up,
and each top-level operation that failed, took a second or more, or answered an agent, with how
long it took. A tool call names the tool, never what the agent passed it, and says when it answered
with an error. The home folder shows as `~`, and the log never holds what is in a video, a prompt,
a chat or a key. A process that starts removes the days older than a week, then the oldest until
the folder holds 50 MB or less. The log stays on this Mac unless the person sends it with feedback.
The open-source CLI keeps none; from source, `CUTFAC_LOG_DIR` names a folder to keep one in.

## Error reports and usage statistics

A release build can report failures and count usage to the Cutfac team's PostHog project (US
cloud), once the person says yes. One question covers both, with "Share" and "Don't share" as
equal answers and neither picked: the first launch asks it on its last step, and the board asks
it once in a build that can send when nothing has answered it yet. Going on without an answer is
not sharing. Settings has a switch for each; nothing is sent before a yes, and a no takes hold at
once. A report is a
PostHog `$exception`: the failure's type and message with the home folder as `~`, the operation
that failed, the process (`app`, `server` or `mcp`), the app's version and platform, and the cause
up to 4,000 characters. Its only identity is the install ID, a random ID made with the first
answer that Settings can renew, and PostHog keeps no person profile for it. Each process reports
each failure once a run, and at most 20 of them. Never a video, a prompt, a chat, a file's
contents or a key.

The reports ride on the log: whatever the log keeps at error level, including a top-level
operation that failed, also goes to `ErrorSink`, which `src/errorReports.ts` fills. Only a build
made with `CUTFAC_POSTHOG_KEY` set can send them: `build:sidecar` and `build:electron` pass
`--env='CUTFAC_POSTHOG_*'`, which writes the key into the build, and the release script requires
it. Source builds and forks have no key, so they ask nothing and send nothing. The choice and the
install ID live in `telemetry.json` in the app's data folder.

Usage statistics, in `src/usageStats.ts`, count that something was done, never what it was about,
under the same install ID and with no person profile: `onboarding_finished` (`answered`,
`screen_recording`, `accessibility`), `video_created` (`template`), `edit_requested` (`versions`)
and `take_kept`, each with the app's version and platform. No session replay and no autocapture.

## Running it from source

```sh
bun run desktop:dev
```

`desktop:dev` opens the desktop app on free ports. The board hot-reloads, the server restarts
itself when `src/` changes, and the app restarts when `electron/` changes. A server restart cuts
off any agent run in progress. Closing the app or Ctrl+C stops everything.

On macOS it runs as Cutfac Dev (`com.cutfac.app.dev`), a copy of Electron under its own bundle id,
so the permissions you grant it, such as an agent's computer use, stay with it and not with every
app built on Electron. It keeps its settings in `~/Library/Application Support/Cutfac Dev`, apart
from the released app's, so the two can run at once and the Dev Panel's Start over leaves the
released app as it was. Its icon is the Cutfac icon with a DEV band across the bottom, compiled with
Xcode 26's `actool`; without it the app keeps Electron's icon.
