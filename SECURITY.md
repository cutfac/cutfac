# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/w00ing/cutfac/security/advisories/new),
not in a public issue or pull request. Include what you found, how to reproduce it, and the version
or commit you tested.

We'll confirm we got your report within a few days, keep you updated while we fix it, and credit you
in the advisory unless you'd rather we didn't.

## Supported versions

Fixes go into the latest release and `main`. Older versions don't get backports, so update to the
latest release to get them.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## What's in scope

- The local server and its API: any way for a web page to call the API, run an agent, or read or
  write files
- The MCP server and the tools it gives agents
- The workspace root guard: any way to read or write outside the workspace through Cutfac
- The board, for example script injection through workspace files, learned videos or agent output
- The Mac app: its sidecar, the license key it stores, and the update path from cutfac.com to the
  installed app

## What's out of scope

- What an agent does with the permissions you gave it. Claude Code and Codex run as you, with your
  login and your settings, and Cutfac doesn't sandbox them.
- Bugs in Claude Code, Codex, ffmpeg, yt-dlp, whisper or other tools Cutfac calls. Report those to
  their maintainers.
- Builds you sign and ship yourself, and unsigned `dist:desktop` builds.
- Other programs and accounts on your machine. Like most local dev servers, anything running on
  your Mac can reach `127.0.0.1`.
- Running the server with `--host` on an interface others can reach. The API has no login, so only
  do this on a network you trust.

## How the server protects itself

The server listens on `127.0.0.1` by default. It answers only requests addressed to a loopback name
or to the address it listens on, which stops DNS rebinding, and it refuses requests that another
website sends from a browser, checked by their `Origin` and `Sec-Fetch-Site` headers. Agents and
tools like `curl` don't send those headers, so they keep working.
