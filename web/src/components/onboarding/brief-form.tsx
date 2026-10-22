import { useId } from "react";

import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { useMessages } from "../../i18n/index.ts";
import { PLATFORMS, PURPOSES, type BriefDraft } from "../../lib/brief.ts";

/**
 * A card to pick, as a purpose or a reference is: tinted on hover, and outlined with a fill once
 * picked. A radio inside marks it picked with `has-checked`, a toggle button with `aria-pressed`.
 */
export const choiceCard = cn(
  "flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors outline-none",
  "hover:bg-muted/50 focus-visible:bg-muted/50 has-focus-visible:bg-muted/50",
  "has-checked:border-foreground/40 has-checked:bg-muted aria-pressed:border-foreground/40 aria-pressed:bg-muted",
);

interface BriefFormProps {
  value: BriefDraft;
  onChange: (next: BriefDraft) => void;
  disabled?: boolean;
}

/**
 * What the videos are for, in the user's words, and where they go: the brief as step 5 asks for it
 * and the sidebar's sheet edits it.
 */
export function BriefForm({ value, onChange, disabled = false }: BriefFormProps) {
  const t = useMessages().start.brief;
  const name = useId();
  const bodyId = useId();
  const own = value.purpose === "own";

  return (
    <div className="flex flex-col gap-6">
      <FieldSet disabled={disabled}>
        <FieldLegend variant="label">{t.purposeLabel}</FieldLegend>
        <div className="grid grid-cols-2 gap-2">
          {PURPOSES.map((purpose) => (
            <label key={purpose} className={choiceCard}>
              <input
                type="radio"
                name={name}
                value={purpose}
                checked={value.purpose === purpose}
                onChange={() => onChange({ ...value, purpose })}
                className="sr-only"
              />
              <span className="text-sm font-medium">{t.purpose[purpose].title}</span>
              <span className="text-xs text-muted-foreground">{t.purpose[purpose].hint}</span>
            </label>
          ))}
        </div>
      </FieldSet>
      {value.purpose === null ? null : (
        // Opens once a purpose is picked, so the example it shows fits the pick.
        <div className="animate-in duration-200 fade-in">
          <Field>
            <FieldLabel htmlFor={bodyId}>{own ? t.ownBodyLabel : t.bodyLabel}</FieldLabel>
            <Textarea
              id={bodyId}
              value={value.body}
              disabled={disabled}
              placeholder={t.purpose[value.purpose].example}
              className="min-h-20"
              onChange={(event) => onChange({ ...value, body: event.target.value })}
            />
          </Field>
        </div>
      )}
      <Field>
        <FieldTitle>{t.platformsLabel}</FieldTitle>
        <ToggleGroup
          multiple
          variant="outline"
          disabled={disabled}
          aria-label={t.platformsLabel}
          value={value.platforms}
          className="flex-wrap"
          onValueChange={(picked) =>
            // Kept in one order, whatever order they were picked in.
            onChange({ ...value, platforms: PLATFORMS.filter((p) => picked.includes(p)) })
          }
        >
          {PLATFORMS.map((platform) => (
            <ToggleGroupItem key={platform} value={platform}>
              {t.platform[platform]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>{t.platformsHint}</FieldDescription>
      </Field>
    </div>
  );
}
