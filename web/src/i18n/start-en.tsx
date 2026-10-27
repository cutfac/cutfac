import type { Platform, Purpose } from "../lib/brief.ts";

interface PurposeCopy {
  title: string;
  hint: string;
  /** The body field's example for this purpose. */
  example: string;
  /** How the sidebar's one line names it. */
  short: string;
}

/**
 * The brief and the first template: what the videos are for, asked a part at a time, and the first
 * video while the agent makes the template. The brief's form shows again on the Brief page.
 */
export const startEn = {
  brief: {
    purposeLabel: "What do you do?",
    purpose: {
      promote: {
        title: "I run a business",
        hint: "A product, app, shop or service",
        example: "e.g. A budgeting app for students. Light and friendly.",
        short: "Promotion",
      },
      tips: {
        title: "I teach what I know",
        hint: "Expertise, how-tos, lessons",
        example: "e.g. Quick cooking tips for busy people.",
        short: "Tips",
      },
      brand: {
        title: "I'm a creator",
        hint: "My day, my thoughts, my story",
        example: "e.g. A designer sharing their day. Calm and honest.",
        short: "Personal brand",
      },
      own: {
        title: "Something else",
        hint: "Say it in your own words",
        example: "e.g. Lyric videos for my band's songs.",
        short: "Own words",
      },
    } satisfies Record<Purpose, PurposeCopy>,
    bodyLabel: "Anything your agent should know?",
    ownBodyLabel: "What do you want to make?",
    platformsLabel: "Where will they go?",
    platformsHint: "Pick any. They set the shape and length.",
    platform: {
      tiktok: "TikTok",
      shorts: "YouTube Shorts",
      reels: "Instagram Reels",
      other: "Other",
    } satisfies Record<Platform, string>,
    platformShort: {
      tiktok: "TikTok",
      shorts: "Shorts",
      reels: "Reels",
      other: "Other",
    } satisfies Record<Platform, string>,
    title: "Purpose and platforms",
    body: "Your agent reads it before every template and video.",
    save: "Save",
    saved: "Brief saved",
    saveFailed: (message: string) => `Could not save the brief: ${message}`,
  },
  whatToMake: {
    title: "What do you do?",
    body: "Your agent reads it before every video. You can change it all later under Brief in the sidebar.",
    details: {
      title: "Anything else your agent should know?",
      body: "Write down whatever comes to mind. Long and detailed is fine, or leave it empty.",
      ownBody: "Write down whatever comes to mind. Long and detailed is fine.",
    },
    material: {
      website: {
        title: "Any website your agent should read?",
        body: "Like your product page or app listing.",
      },
      folder: {
        title: "Any folder your agent should read?",
        body: "Like a brand kit or your footage. It stays where it is.",
      },
      placeholder: "https://your-site.com",
      add: "Add",
      choose: "Choose folder…",
      remove: (source: string) => `Remove ${source}`,
    },
    next: "Next",
    back: "Back",
    skipPart: "Skip",
    start: "Start making",
    starting: "Starting…",
    skip: "Skip for now",
    learnFailed: (source: string, message: string) => `Could not read ${source}: ${message}`,
  },
  /**
   * Turning on notifications, offered on the empty board since that is when they help: the app tells
   * the user when the agent waits for them. macOS asks on the first one, so Turn on puts up a sample.
   */
  notify: {
    label: "Get notified when your agent needs you",
    turnOn: "Turn on",
    done: "Notifications on",
    sample: { title: "Cutfac", body: "This is how Cutfac tells you your agent is waiting." },
  },
  /** While the first launch's answers go into the new workspace, a moment before the board. */
  saving: {
    title: "Setting up your workspace",
    body: "Saving what you told your agent…",
  },
};

export type StartMessages = typeof startEn;
