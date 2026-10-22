/**
 * References the first template can start from: public examples that are ready to use as they are,
 * each under a license that allows reuse. Built in for now; the app is to fetch the list from
 * cutfac.com so it grows without a release.
 */
export interface GalleryEntry {
  /** Names the entry's text in the board's messages. */
  readonly id: GalleryId;
  readonly link: string;
  readonly license: string;
}

export type GalleryId = "opuscar" | "mgStyles" | "animationBase" | "lyricVideo";

export const GALLERY: ReadonlyArray<GalleryEntry> = [
  { id: "opuscar", link: "https://github.com/lemomo-ai/lemo-opuscar", license: "MIT" },
  { id: "mgStyles", link: "https://github.com/Vincentwei1021/mg-styles-15", license: "MIT" },
  {
    id: "animationBase",
    link: "https://github.com/JohnHeibel/ClaudeAnimationBase",
    license: "MIT",
  },
  { id: "lyricVideo", link: "https://github.com/mexicat/pdoom-video", license: "MIT" },
];
