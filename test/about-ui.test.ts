import { expect, test } from "bun:test";

import { aboutParts } from "../web/src/lib/about.ts";

const ABOUT = `# About

What this workspace makes videos about. Agents read this file before they work; anyone can edit it.

## Cutfac
<!-- learned:cutfac-com -->

- Link: https://cutfac.com
- By: Cutfac
- Saved: learned/cutfac/

A video editor you talk to.

### Voice
Plain and warm.

## Tone
Never say "revolutionary".

## Docs
<!-- learned:docs -->
> Not read yet: an agent should read the source, rewrite this section with what matters for the videos, and delete this line.

- Link: https://cutfac.com/docs
`;

test("what an agent wrote for a source stays with it, deeper headings included, without where it came from", () => {
  const { learned } = aboutParts(ABOUT);

  expect(learned.get("cutfac-com")).toBe(
    "A video editor you talk to.\n\n### Voice\nPlain and warm.",
  );
  expect(learned.get("docs")).toBe("");
});

test("a section a person added shows as notes, without the header every about.md has", () => {
  expect(aboutParts(ABOUT).notes).toBe('## Tone\nNever say "revolutionary".');
});

test("an about.md with only its header has no notes", () => {
  expect(
    aboutParts(
      "# About\n\nWhat this workspace makes videos about. Agents read this file before they work; anyone can edit it.\n",
    ).notes,
  ).toBe("");
});
