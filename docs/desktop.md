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
platform and language, which way it came, and the agent, if one was involved. Nothing else is sent.

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
