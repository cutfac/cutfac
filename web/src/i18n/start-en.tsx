import type { Platform, Purpose } from "../lib/brief.ts";
import type { RunPhase } from "../lib/onboarding.ts";

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
    body: "Tell your agent a little, and it sets up how your videos get made. You can change it all later under Brief in the sidebar.",
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
    noAgent: "No agent is ready. Set one up in Setup, then try again.",
  },
  firstVideo: {
    /**
     * Turning on notifications, asked here since it is when they help: the app tells the user when
     * the agent waits for them. macOS asks on the first one, so Turn on puts up a sample.
     */
    notify: {
      label: "Get notified when your agent needs you",
      turnOn: "Turn on",
      done: "Notifications on",
      sample: { title: "Cutfac", body: "This is how Cutfac tells you your agent is waiting." },
    },
    title: "Your first video",
    body: "Your agent is setting up how this kind of video gets made. Give the first one a title meanwhile.",
    readyBody:
      "Your agent set up how this kind of video gets made. Give the first one a title to open it.",
    starting: "Starting your agent…",
    phase: {
      reading: "Reading your brief and the reference…",
      writing: "Building the template…",
      checking: "Checking that it renders…",
    } satisfies Record<RunPhase, string>,
    asking: "Your agent has a question",
    answer: "Or answer in your own words",
    send: "Send",
    ready: "The template is ready",
    settled: "Settled for you. Click one to change it.",
    change: (item: string) => `Change “${item}” to…`,
    /** Sent to the agent when the user changes something it settled. */
    changeBody: (item: string, text: string) => `About "${item}": ${text}`,
    failed: "Your agent stopped before the template was ready.",
    noTemplate: "Your agent finished without making a template.",
    retry: "Try again",
    withoutReference: "Make it without a reference",
    titleLabel: "Video title",
    titlePlaceholder: "e.g. Launch week teaser",
    create: "Create video",
    creating: "Creating…",
    waitHint: "You can create it once the template is ready.",
    later: "Continue on the board",
    createFailed: (message: string) => `Could not create the video: ${message}`,
  },
};

export type StartMessages = typeof startEn;
