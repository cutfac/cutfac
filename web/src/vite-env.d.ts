/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `version` from package.json, filled in by `define` in vite.config.ts. */
  readonly APP_VERSION: string;
  /** The Tally form behind "Send feedback". Without it the sidebar has no feedback entry. */
  readonly VITE_FEEDBACK_FORM_ID?: string;
}
