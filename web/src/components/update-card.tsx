import { Match, Option } from "effect";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { desktop } from "../desktop.ts";
import { currentLocale, messages, useMessages } from "../i18n/index.ts";
import { changelogUrl } from "../lib/license.ts";
import {
  decodeUpdateNotice,
  decodeUpdateStatus,
  NO_UPDATE,
  type UpdateStatus,
} from "../lib/updates.ts";

/** The app's update as it goes, from the status it has now. */
function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>(NO_UPDATE);

  useEffect(() => {
    const updates = desktop?.updates;

    if (updates === undefined) return;

    let current = true;

    const show = (sent: UpdateStatus) => {
      if (current) setStatus(Option.getOrElse(decodeUpdateStatus(sent), () => NO_UPDATE));
    };

    updates.status().then(show, () => undefined);

    const stop = updates.onStatus(show);

    return () => {
      current = false;
      stop();
    };
  }, []);

  return status;
}

/**
 * The app's update at the foot of the sidebar: the download the user asked for as it goes, then a
 * restart to install it, whichever way it came. Nothing otherwise, so it never interrupts.
 */
export function UpdateCard() {
  const t = useMessages().updates;
  const status = useUpdateStatus();

  return Match.value(status).pipe(
    Match.tag("Idle", () => null),
    Match.tag("Downloading", ({ version, percent }) => (
      <div className="grid gap-2 rounded-2xl border bg-card p-3 text-card-foreground group-data-[collapsible=icon]:hidden">
        <p className="text-sm font-medium">{t.downloading(version)}</p>
        <Progress aria-label={t.downloading(version)} value={percent} max={100} />
      </div>
    )),
    Match.tag("Ready", ({ version }) => (
      <div className="grid gap-3 rounded-2xl border bg-card p-3 text-card-foreground group-data-[collapsible=icon]:hidden">
        <div className="grid gap-0.5">
          <p className="text-sm font-medium">{t.ready(version)}</p>
          <p className="text-xs text-muted-foreground">{t.readyDetail}</p>
        </div>
        <Button size="sm" onClick={() => void desktop?.updates.restart()}>
          {t.restart}
        </Button>
      </div>
    )),
    Match.exhaustive,
  );
}

/** Says once that the app updated, and what a check from the menu found, in toasts. */
export function UpdateToasts() {
  useEffect(() => {
    const updates = desktop?.updates;

    if (updates === undefined) return;

    updates.updatedTo().then(
      (version) => {
        if (version === undefined) return;

        const t = messages().updates;

        toast(t.updated(version), {
          action: {
            label: t.whatsNew,
            onClick: () => window.open(changelogUrl(currentLocale()), "_blank", "noopener"),
          },
        });
      },
      () => undefined,
    );

    return updates.onNotice((sent) => {
      const t = messages().updates;

      Option.map(decodeUpdateNotice(sent), (notice) =>
        notice.kind === "upToDate"
          ? toast.success(t.upToDate(notice.version))
          : toast.error(t.checkFailed, { description: notice.message }),
      );
    });
  }, []);

  return null;
}
