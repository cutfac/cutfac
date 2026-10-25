import { ArrowUpIcon, ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { useMessages } from "../../i18n/index.ts";
import { MAX_VARIANTS } from "../../lib/requests.ts";

/**
 * Two ways to ask for several versions, side by side until one is picked: a menu on the send
 * button, or chips under the box. Set `cutfac.versionsStyle` in local storage to `chips` for the
 * second.
 */
type VersionsStyle = "split" | "chips";

const STYLE_KEY = "cutfac.versionsStyle";

function storedStyle(): VersionsStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === "chips" ? "chips" : "split";
  } catch {
    return "split";
  }
}

const versionsStyle = storedStyle();

const COUNTS = Array.from({ length: MAX_VARIANTS }, (_, index) => index + 1);

interface SendButtonProps {
  label: string;
  disabled: boolean;
  /** Send asking for `count` versions, or for as many as the chips say without one. */
  onSend: (count?: number) => void;
}

/** The send button, with a menu beside it to send as several versions at once. */
export function SendButton({ label, disabled, onSend }: SendButtonProps) {
  const t = useMessages();

  const send = (
    <InputGroupButton
      variant="default"
      size="icon-sm"
      className={versionsStyle === "split" ? undefined : "ml-auto"}
      aria-label={label}
      disabled={disabled}
      onClick={() => onSend()}
    >
      <ArrowUpIcon />
    </InputGroupButton>
  );

  if (versionsStyle === "chips") return send;

  return (
    <div className="ml-auto flex items-center gap-0.5">
      {send}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={<InputGroupButton size="icon-sm" aria-label={t.composer.versions.label} />}
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-auto">
          {COUNTS.map((count) => (
            <DropdownMenuItem key={count} onClick={() => onSend(count)}>
              {t.composer.versions.sendAs(count)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** How many versions the next request makes, as chips under the box. */
export function VersionChips({
  value,
  onChange,
}: {
  value: number;
  onChange: (versions: number) => void;
}) {
  const t = useMessages();

  if (versionsStyle === "split") return null;

  return (
    <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <span>{t.composer.versions.label}</span>
      <ToggleGroup
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={t.composer.versions.label}
        value={[String(value)]}
        onValueChange={(picked) => {
          const next = COUNTS.find((count) => picked.includes(String(count)));

          if (next !== undefined) onChange(next);
        }}
      >
        {COUNTS.map((count) => (
          <ToggleGroupItem key={count} value={String(count)}>
            {count}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
