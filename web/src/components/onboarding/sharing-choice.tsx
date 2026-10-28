import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { Sharing, SharingPurpose } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";

const PURPOSES: ReadonlyArray<SharingPurpose> = ["errorReports", "usageStats"];

/**
 * What to share with the Cutfac team, asked for each purpose on its own: two answers of the same
 * weight per purpose, neither picked until the person picks one. Settings has a switch for each.
 */
export function SharingChoice({
  value,
  disabled,
  onChange,
}: {
  value: Sharing;
  disabled: boolean;
  onChange: (purpose: SharingPurpose, share: boolean) => void;
}) {
  const t = useMessages().reports;

  const copy = {
    errorReports: { title: t.errorReports, hint: t.toggleHint },
    usageStats: { title: t.usageStats, hint: t.usageHint },
  } satisfies Record<SharingPurpose, { title: string; hint: string }>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.askTitle}</span>
        <p className="text-xs text-pretty text-muted-foreground">{t.askBody}</p>
      </div>
      {PURPOSES.map((purpose) => {
        const answered = value[purpose];

        return (
          <div key={purpose} className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm">{copy[purpose].title}</span>
              <span className="text-xs text-pretty text-muted-foreground">
                {copy[purpose].hint}
              </span>
            </div>
            {/* Picked as the other choices on the first launch are, so the row doesn't move. */}
            <ToggleGroup
              variant="choice"
              size="sm"
              spacing={2}
              disabled={disabled}
              aria-label={copy[purpose].title}
              value={answered === null ? [] : [answered ? "share" : "keep"]}
              onValueChange={([picked]) => {
                if (picked !== undefined) onChange(purpose, picked === "share");
              }}
              className="grid shrink-0 grid-cols-2"
            >
              <ToggleGroupItem value="keep">{t.dontShare}</ToggleGroupItem>
              <ToggleGroupItem value="share">{t.share}</ToggleGroupItem>
            </ToggleGroup>
          </div>
        );
      })}
    </div>
  );
}
