import { useEffect } from "react";

import { desktop } from "../desktop.ts";
import { openNewVideo } from "../lib/firstVideo.ts";

/**
 * A `cutfac://new` link on a web page opens a new video with the page's request waiting in its
 * chat, for the user to look over and send. Mount it once.
 */
export function NewVideoLinks() {
  useEffect(() => desktop?.onNewVideoLink((link) => void openNewVideo(link.prompt)), []);

  return null;
}
