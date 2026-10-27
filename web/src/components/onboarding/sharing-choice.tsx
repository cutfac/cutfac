import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useMessages } from "../../i18n/index.ts";

/**
 * Whether to share error reports and usage statistics with the Cutfac team: two answers of the
 * same weight, neither picked until the person picks one. Settings has a switch for each later.
 */
export function SharingChoice({
  value,
  disabled,
  onChange,
}: {
  value: boolean | null;
  disabled: boolean;
  onChange: (share: boolean) => void;
}) {
  const t = useMessages().reports;

  const answer = (share: boolean, label: string) => (
    <Button
      variant="secondary"
      aria-pressed={value === share}
      disabled={disabled}
      onClick={() => onChange(share)}
    >
      {value === share ? <CheckIcon data-icon="inline-start" /> : null}
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t.askTitle}</span>
        <p className="text-xs text-pretty text-muted-foreground">{t.askBody}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {answer(false, t.dontShare)}
        {answer(true, t.share)}
      </div>
    </div>
  );
}
