/** The render card beside the preview, and the chat's line while a render runs. */
export const renderEn = {
  stages: { preparing: "Prepare", frames: "Frames", encoding: "Encode" },
  frames: (done: number, total: number) => `${done}/${total} frames`,
  elapsed: (time: string) => `${time} elapsed`,
  left: (time: string) => `about ${time} left`,
  percent: (percent: number) => `Rendering ${percent}%`,
  rendering: "Rendering",
  done: (time: string) => `Done · ${time}`,
  failed: "Render failed",
  fixing: "The agent is reading the error to fix it.",
  stopped: "Render stopped",
  stop: "Stop",
  log: "Output",
  previous: "Previous version",
  /** A render the agent runs in its own shell: the board can't tell how far it is. */
  shell: "The agent is rendering in its shell, so progress isn't shown.",
};

export type RenderMessages = typeof renderEn;
