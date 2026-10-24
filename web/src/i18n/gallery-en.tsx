/** A gallery tile's line on where its video stands, and what the tile lets the user do. */
export const galleryEn = {
  versions: (count: number) => (count === 1 ? "1 version to check" : `Pick from ${count} versions`),
  halted: "Stopped",
  working: "Working",
  result: "New result",
  compare: "Compare",
};

export type GalleryMessages = typeof galleryEn;
