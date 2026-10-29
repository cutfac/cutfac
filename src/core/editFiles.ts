import type { Item } from "./items.ts";
import { extension } from "./media.ts";

export const editDir = (item: Item, feedbackId: string) => `${item.dir}/edits/${feedbackId}`;

export const variantsDir = (item: Item, feedbackId: string) =>
  `${editDir(item, feedbackId)}/variants`;

/** Where a version keeps the agent's code that rendered it, to put back if the user keeps it. */
export const variantCodeDir = (item: Item, feedbackId: string, variantId: string) =>
  `${variantsDir(item, feedbackId)}/${variantId}.code`;

/** Where a request keeps the media as it was when the request was made. */
export const beforeFile = (item: Item, feedbackId: string, media: string) =>
  `${editDir(item, feedbackId)}/before.${extension(media)}`;

/** Where a request keeps its result of `media`. */
export const afterFile = (item: Item, feedbackId: string, media: string) =>
  `${editDir(item, feedbackId)}/after.${extension(media)}`;

/**
 * Where a version the user kept stays, one file each, so undo and redo can move between the
 * versions of a request.
 */
export const keptFile = (item: Item, feedbackId: string, variantId: string, media: string) =>
  `${editDir(item, feedbackId)}/kept-${variantId}.${extension(media)}`;

/** Whether `file`, item-relative, is where `variantId` of the request was kept. */
export const isKeptFile = (file: string, feedbackId: string, variantId: string) =>
  file.startsWith(`edits/${feedbackId}/kept-${variantId}.`);

/** Item-relative path (the form feedback.context stores) for a workspace-relative path. */
export const itemRel = (item: Item, rel: string) => rel.slice(item.dir.length + 1);
