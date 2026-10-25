import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";

import type { AgentStatus, ModelSettings } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { effortLabel, effortsFor, usableSettings } from "../../lib/models.ts";

interface ModelPickerProps {
  status: AgentStatus;
  settings: ModelSettings;
  onPick: (settings: ModelSettings) => void;
}

/** One quiet setting under the composer: its value by name, opening a list to pick from. */
function Setting({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string | undefined;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  const shown = options.find((option) => option.value === value)?.label ?? value ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // In a narrow chat the name gives way first, so the send button stays in view.
        render={
          <InputGroupButton
            title={`${label}: ${shown}`}
            aria-label={`${label}: ${shown}`}
            className="min-w-0 shrink"
          />
        }
      >
        <span className="truncate">{shown}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-auto min-w-40">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onPick}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The model and reasoning effort the agent runs with, each by name. Picking a model that does not
 * take the chosen effort moves the effort to one it does.
 */
export function ModelPicker({ status, settings, onPick }: ModelPickerProps) {
  const t = useMessages();
  const m = t.composer.models;
  const efforts = effortsFor(status, settings.model);
  const pick = (next: ModelSettings) => onPick(usableSettings(status, next));

  return (
    <>
      {status.models.length > 0 ? (
        <Setting
          label={m.model}
          value={settings.model}
          options={status.models.map((option) => ({ value: option.id, label: option.label }))}
          onPick={(model) => pick({ ...settings, model })}
        />
      ) : null}
      {efforts.length > 0 ? (
        <Setting
          label={m.effort}
          value={settings.effort}
          options={efforts.map((effort) => ({ value: effort, label: effortLabel(effort, t) }))}
          onPick={(effort) => pick({ ...settings, effort })}
        />
      ) : null}
    </>
  );
}
