import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";

import type { AgentStatus, ModelSettings } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import {
  effortLabel,
  effortsFor,
  modelLabel,
  settingsLabels,
  usableSettings,
} from "../../lib/models.ts";

/** The choice that leaves the model or effort to the agent; no id or effort is empty. */
const BY_DEFAULT = "";

/** Settings from the two choices, leaving out what is left to the agent. */
function fromChoices(model: string, effort: string): ModelSettings {
  const settings: ModelSettings = {};

  if (model !== BY_DEFAULT) settings.model = model;

  if (effort !== BY_DEFAULT) settings.effort = effort;

  return settings;
}

interface ModelPickerProps {
  status: AgentStatus;
  settings: ModelSettings;
  onPick: (settings: ModelSettings) => void;
}

/**
 * The model and reasoning effort the agent runs with. Picking a model that does not take the
 * chosen effort sets the effort back to the default.
 */
export function ModelPicker({ status, settings, onPick }: ModelPickerProps) {
  const t = useMessages();
  const m = t.composer.models;
  const model = settings.model ?? BY_DEFAULT;
  const effort = settings.effort ?? BY_DEFAULT;
  const efforts = effortsFor(status, settings.model);
  const own = status.models.find((option) => option.id === settings.model)?.defaultEffort;
  const labels = settingsLabels(status, settings, t);
  // The agent's own pick shows by name, so no one has to guess what "default" means.
  const ownModel = status.defaultModel ?? m.defaultModel;
  const shown = (settings.model === undefined ? [ownModel, ...labels] : labels).join(" · ");
  const pick = (next: ModelSettings) => onPick(usableSettings(status, next));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // In a narrow chat the label gives way first, so the send button stays in view.
        render={
          <InputGroupButton
            title={`${m.label}: ${shown}`}
            aria-label={`${m.label}: ${shown}`}
            className="min-w-0 shrink"
          />
        }
      >
        <span className="truncate">{shown}</span>
        <ChevronDownIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-auto min-w-48">
        {status.models.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{m.model}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={model}
              onValueChange={(value: string) => pick(fromChoices(value, effort))}
            >
              <DropdownMenuRadioItem value={BY_DEFAULT}>
                {m.byDefault(status.defaultModel)}
              </DropdownMenuRadioItem>
              {status.models.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {modelLabel(status, option.id)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ) : null}
        {status.models.length > 0 && efforts.length > 0 ? <DropdownMenuSeparator /> : null}
        {efforts.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>{m.effort}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={effort}
              onValueChange={(value: string) => pick(fromChoices(model, value))}
            >
              <DropdownMenuRadioItem value={BY_DEFAULT}>
                {m.byDefault(own === undefined ? undefined : effortLabel(own, t))}
              </DropdownMenuRadioItem>
              {efforts.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {effortLabel(option, t)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
