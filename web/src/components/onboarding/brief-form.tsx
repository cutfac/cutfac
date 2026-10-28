import { useEffect, useId, useRef } from "react";

import { PlatformIcon } from "@/components/platform-icon";
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
import { PLATFORMS, PURPOSES, type BriefDraft, type Purpose } from "../../lib/brief.ts";

/**
 * A tile to pick, as a purpose is: a light fill with no edge, as the buttons have, deeper on hover
 * and outlined once picked by the radio inside it.
 */
const choiceCard = cn(
  "flex flex-col items-start gap-1 rounded-2xl bg-foreground/6 p-3 text-left transition-colors outline-none",
  "hover:bg-foreground/10 has-focus-visible:bg-foreground/10",
  "has-checked:bg-brand/12 has-checked:ring-1 has-checked:ring-brand has-checked:hover:bg-brand/16",
);

interface PartProps {
  value: BriefDraft;
  onChange: (next: BriefDraft) => void;
  disabled?: boolean;
}

/**
 * What the videos are for, as cards to pick one of. `onClicked` hears a card clicked with the
 * pointer, not one reached with the arrow keys, so a step can move on when it is picked.
 */
export function PurposeCards({
  value,
  onChange,
  disabled = false,
  label,
  onClicked,
}: PartProps & { label?: string; onClicked?: (purpose: Purpose) => void }) {
  const t = useMessages().start.brief;
  const name = useId();

  return (
    <FieldSet disabled={disabled}>
      {label === undefined ? null : <FieldLegend variant="label">{label}</FieldLegend>}
      <div className="grid grid-cols-2 gap-2">
        {PURPOSES.map((purpose) => (
          <label key={purpose} className={choiceCard}>
            <input
              type="radio"
              name={name}
              value={purpose}
              checked={value.purpose === purpose}
              onChange={() => onChange({ ...value, purpose })}
              onClick={(event) => {
                // A click from the keyboard has no detail; only a pointer's moves on.
                if (event.detail > 0) onClicked?.(purpose);
              }}
              className="sr-only"
            />
            <span className="text-sm font-medium">{t.purpose[purpose].title}</span>
            <span className="text-xs text-muted-foreground">{t.purpose[purpose].hint}</span>
          </label>
        ))}
      </div>
    </FieldSet>
  );
}

/** The user's own words, with an example that fits the purpose. */
export function BriefBody({
  value,
  onChange,
  disabled = false,
  label,
  focusOnOpen = false,
}: PartProps & { label?: string; focusOnOpen?: boolean }) {
  const t = useMessages().start.brief;
  const id = useId();
  const own = value.purpose === "own";
  const field = useRef<HTMLTextAreaElement>(null);

  // A step that asks only for these words is ready to type into.
  useEffect(() => {
    if (focusOnOpen) field.current?.focus();
  }, [focusOnOpen]);

  return (
    <Field>
      {label === undefined ? null : <FieldLabel htmlFor={id}>{label}</FieldLabel>}
      <Textarea
        id={id}
        value={value.body}
        disabled={disabled}
        ref={field}
        aria-label={own ? t.ownBodyLabel : t.bodyLabel}
        placeholder={value.purpose === null ? undefined : t.purpose[value.purpose].example}
        // Tall enough to invite everything that comes to mind, not a line.
        className="min-h-40"
        onChange={(event) => onChange({ ...value, body: event.target.value })}
      />
    </Field>
  );
}

/** Where the videos go, any of them. */
export function PlatformToggles({
  value,
  onChange,
  disabled = false,
  label,
  hint,
}: PartProps & { label?: string; hint?: string }) {
  const t = useMessages().start.brief;

  return (
    <Field>
      {label === undefined ? null : <FieldTitle>{label}</FieldTitle>}
      <ToggleGroup
        multiple
        variant="choice"
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
            <PlatformIcon platform={platform} />
            {t.platform[platform]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {hint === undefined ? null : <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}

/**
 * The whole brief on one form, as the Brief page edits it: what the videos are for, in the user's
 * words, and where they go. The first launch asks for the same parts one at a time.
 */
export function BriefForm({ value, onChange, disabled = false }: PartProps) {
  const t = useMessages().start.brief;
  const parts = { value, onChange, disabled };

  return (
    <div className="flex flex-col gap-6">
      <PurposeCards {...parts} label={t.purposeLabel} />
      {value.purpose === null ? null : (
        // Opens once a purpose is picked, so the example it shows fits the pick.
        <div className="animate-in duration-200 fade-in">
          <BriefBody {...parts} label={value.purpose === "own" ? t.ownBodyLabel : t.bodyLabel} />
        </div>
      )}
      <PlatformToggles {...parts} label={t.platformsLabel} hint={t.platformsHint} />
    </div>
  );
}
