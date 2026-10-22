import type { Platform, Purpose } from "../lib/brief.ts";
import type { GalleryId } from "../lib/gallery.ts";
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
 * The brief and the first template: what the videos are for, the reference to start from, and the
 * first video while the agent makes the template. The brief's form shows again in the sidebar.
 */
export const startEn = {
  brief: {
    purposeLabel: "What are the videos for?",
    purpose: {
      promote: {
        title: "Promote something",
        hint: "Your product, app or service",
        example: "e.g. A budgeting app for students. Light and friendly.",
        short: "Promotion",
      },
      tips: {
        title: "Share tips",
        hint: "Information and how-tos",
        example: "e.g. Quick cooking tips for busy people.",
        short: "Tips",
      },
      brand: {
        title: "Grow a personal brand",
        hint: "You, your voice, your story",
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
    } satisfies Record<Platform, string>,
    platformShort: {
      tiktok: "TikTok",
      shorts: "Shorts",
      reels: "Reels",
    } satisfies Record<Platform, string>,
    /** The sidebar's line when the brief says nothing yet. */
    add: "Add a brief",
    sheetTitle: "Brief",
    sheetBody: "What your videos are for. Your agent reads it before every template and video.",
    save: "Save",
    saved: "Brief saved",
    saveFailed: (message: string) => `Could not save the brief: ${message}`,
  },
  whatToMake: {
    title: "What will you make?",
    body: "Tell your agent a little, and it sets up how your videos get made. You can change it all later.",
    optional: "Optional",
    material: {
      label: "Your material",
      hint: "A website or folder your agent should read, like your product page or a brand kit.",
      placeholder: "https://your-site.com",
      add: "Add",
      choose: "Choose folder…",
      remove: (source: string) => `Remove ${source}`,
    },
    reference: {
      label: "Start from a reference",
      hint: "Pick an example to build on. Without one, your agent starts from what it knows.",
      paste: "Or paste a link to a skill, starter kit or video",
      open: (title: string) => `Open ${title}`,
    },
    start: "Start making",
    starting: "Starting…",
    skip: "Skip for now",
    learnFailed: (source: string, message: string) => `Could not read ${source}: ${message}`,
    noAgent: "No agent is ready. Set one up in Setup, then try again.",
  },
  gallery: {
    opuscar: {
      title: "Film styles",
      description: "51 film styles, each a prompt and a demo made in code",
    },
    mgStyles: {
      title: "Motion graphics",
      description: "15 motion graphics styles, with prompts and source",
    },
    animationBase: {
      title: "Hand-painted animation",
      description: "A starter kit for hand-painted cartoon animation",
    },
    lyricVideo: {
      title: "Lyric video",
      description: "A finished lyric music video, rendered locally",
    },
  } satisfies Record<GalleryId, { title: string; description: string }>,
  firstVideo: {
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
