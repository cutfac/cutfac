import { z } from "zod";

export const ITEM_STATUSES = [
  "idea",
  "drafting",
  "review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;
export const ItemStatus = z.enum(ITEM_STATUSES);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook", "threads", "x"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

export const ASPECTS = ["9x16", "4x5", "3x4", "1x1", "16x9"] as const;
export const Aspect = z.enum(ASPECTS);
export type Aspect = z.infer<typeof Aspect>;

/** factory.yaml at the workspace root. Paths are workspace-relative. */
export const WorkspaceConfig = z.object({
  name: z.string(),
  timezone: z.string().default("UTC"),
  platforms: z.array(Platform).default(["tiktok", "instagram", "youtube"]),
  paths: z
    .object({
      product: z.string().default("product"),
      references: z.string().default("references"),
      formats: z.string().default("formats"),
      items: z.string().default("items"),
    })
    .prefault({}),
  postiz: z
    .object({
      url: z.string().url(),
      apiKeyEnv: z.string().default("POSTIZ_API_KEY"),
    })
    .optional(),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>;

/** product/product.yaml — the solo developer's app, used by every agent run. */
export const Product = z.object({
  name: z.string(),
  oneLiner: z.string().default(""),
  audience: z.string().default(""),
  stores: z
    .object({
      appStore: z.string().optional(),
      googlePlay: z.string().optional(),
      web: z.string().optional(),
    })
    .prefault({}),
  cta: z
    .object({
      default: z.string().default(""),
      firstComment: z.string().optional(),
    })
    .prefault({}),
  brand: z
    .object({
      colors: z.record(z.string(), z.string()).default({}),
      fonts: z.array(z.string()).default([]),
      voice: z.string().default(""),
    })
    .prefault({}),
  rules: z.array(z.string()).default([]),
});
export type Product = z.infer<typeof Product>;

export const PlatformCopy = z.object({
  title: z.string().optional(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  firstComment: z.string().optional(),
});
export type PlatformCopy = z.infer<typeof PlatformCopy>;

export const ScheduleEntry = z.object({
  platform: Platform,
  at: z.string().describe("ISO 8601 with offset"),
  status: z.enum(["planned", "scheduled", "published", "failed", "cancelled"]).default("planned"),
  externalId: z.string().optional(),
  url: z.string().optional(),
});
export type ScheduleEntry = z.infer<typeof ScheduleEntry>;

export const MetricsEntry = z.object({
  platform: Platform,
  at: z.string(),
  views: z.number().int().nonnegative().optional(),
  likes: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  shares: z.number().int().nonnegative().optional(),
  saves: z.number().int().nonnegative().optional(),
  follows: z.number().int().nonnegative().optional(),
  installs: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
});
export type MetricsEntry = z.infer<typeof MetricsEntry>;

export const Feedback = z.object({
  id: z.string(),
  at: z.string(),
  author: z.string().default("you"),
  body: z.string(),
  media: z.string().optional().describe("item-relative media file the comment is about"),
  timecode: z.number().nonnegative().optional().describe("seconds into the media"),
  status: z.enum(["open", "resolved"]).default("open"),
  resolution: z.string().optional(),
  resolvedAt: z.string().optional(),
});
export type Feedback = z.infer<typeof Feedback>;

/** items/<id>/item.yaml */
export const ItemDoc = z.object({
  title: z.string(),
  status: ItemStatus.default("idea"),
  format: z.string().optional(),
  reference: z.string().optional(),
  hook: z.string().optional(),
  caption: z.string().optional(),
  platforms: z.partialRecord(Platform, PlatformCopy).default({}),
  schedule: z.array(ScheduleEntry).default([]),
  metrics: z.array(MetricsEntry).default([]),
  feedback: z.array(Feedback).default([]),
  notes: z.string().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
});
export type ItemDoc = z.infer<typeof ItemDoc>;

/** references/<id>/reference.yaml */
export const ReferenceDoc = z.object({
  title: z.string(),
  source: z.string().optional().describe("original URL or file name"),
  video: z.string().optional().describe("reference-relative video file"),
  addedAt: z.string(),
  tags: z.array(z.string()).default([]),
  probe: z
    .object({
      duration: z.number(),
      width: z.number(),
      height: z.number(),
      fps: z.number(),
      hasAudio: z.boolean(),
    })
    .optional(),
  preprocessed: z.boolean().default(false),
});
export type ReferenceDoc = z.infer<typeof ReferenceDoc>;

/** formats/<id>/format.yaml — a reusable recipe distilled from references. */
export const FormatDoc = z.object({
  title: z.string(),
  summary: z.string().default(""),
  references: z.array(z.string()).default([]),
  aspects: z.array(Aspect).default(["9x16"]),
  duration: z.object({ min: z.number(), max: z.number() }).optional(),
  fps: z.number().optional(),
  requireAudio: z.boolean().default(true),
  hookRules: z.array(z.string()).default([]),
  structure: z.array(z.string()).default([]),
  render: z
    .string()
    .optional()
    .describe("command that renders one item, run from the workspace root"),
  checklist: z.array(z.string()).default([]),
});
export type FormatDoc = z.infer<typeof FormatDoc>;
