# Audio Studio MCP (reference for later audio work)

Noted 2026-10-19. Not integrated. A starting point for when we build audio features; check it
again then, since it is at v0.1.0 and moving.

- Repo: https://github.com/kanaworksai-hue/audio-studio-mcp (KanaWorks_AI, 東京AI映像合同会社)
- Announcement: https://x.com/kanaworks_ai/status/2111790148010860860

## What it is

A local MCP server for BGM and sound effects with Stable Audio 3. Written in Python (uv). It runs
on MLX on Apple Silicon (M1 or later, 16GB RAM suggested, about 6GB disk, ffmpeg) and on PyTorch
with an NVIDIA GPU on Windows (8GB+ VRAM, about 14GB disk). On a warm M1, 20s of music takes about
10s. Instrumental only: no vocals or lyrics.

Tools:

- `generate_audio`: text to BGM, an instrument loop or stem, or an SFX. 1 to 4 candidates per call,
  with `bpm`.
- `edit_audio`: make a variation, regenerate a time range (inpaint), or extend the end (continue).
- `process_audio`: trim, mono, resample, loudness (LUFS), seamless loop, fades and peak limit, then
  WAV, OGG or FLAC. It leaves the input as it is.
- `unload_models`: free the memory.

Every output gets a `.json` sidecar with its prompt, seed and settings. The server teaches the
client how to write Stable Audio 3 prompts, and the README has setup notes written for agents.
`--http 8765 --preload` keeps one warm server for every session.

## Licenses

- Code: MIT. The KanaWorks_AI name is not covered.
- Model weights: Stability AI Community License, which also covers what the model generates. At the
  time of writing, commercial use is allowed under US$1M in total annual revenue. The Windows
  weights are gated on Hugging Face and need the user's own login.

## How it could fit Cutfac

- The user's agent registers it as a second MCP server next to `cutfac`. Cutfac does not bundle it
  or the weights; it can point the agent at it from the skill or the workspace state.
- The agent generates BGM and SFX into an item's media, like any other source it uses in code.
- Several candidates per call fit making variations to compare and pick from.
- The `.json` sidecar keeps a track reproducible and can sit next to the item's other files.
- LUFS normalization and seamless loops are what short-form BGM needs.

Open questions for then: whether audio becomes a template with its own skill or a core primitive,
how the board shows and swaps tracks, and how to tell users about the weights license.
