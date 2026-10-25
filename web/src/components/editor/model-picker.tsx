import { ChevronDownIcon } from "lucide-react";
import { Fragment } from "react";

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

import type { AgentChoice, AgentName, AgentStatus, ModelSettings } from "../../api.ts";
import { agentInstalled } from "../../hooks.ts";
import { useMessages, type Messages } from "../../i18n/index.ts";
import {
  AGENTS,
  effortLabel,
  effortsFor,
  pickedSettings,
  statusOf,
  usableSettings,
  type ModelPicks,
} from "../../lib/models.ts";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Options listed together, under a heading when they have one. */
interface OptionGroup<O extends Option = Option> {
  id: string;
  label?: string;
  options: ReadonlyArray<O>;
}

/**
 * One quiet setting under the composer: its value by name, opening a list to pick from that scrolls
 * once it runs long. A `bare` one shows its chevron only while pointed at or open, so the model
 * reads as a plain name.
 */
function Setting({
  label,
  value,
  groups,
  bare = false,
  onPick,
}: {
  label: string;
  value: string | undefined;
  groups: ReadonlyArray<OptionGroup>;
  bare?: boolean;
  onPick: (value: string) => void;
}) {
  const shown =
    groups.flatMap((group) => group.options).find((option) => option.value === value)?.label ??
    value ??
    "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // In a narrow chat the name gives way first, so the send button stays in view.
        render={
          <InputGroupButton
            title={`${label}: ${shown}`}
            aria-label={`${label}: ${shown}`}
            className="group/setting min-w-0 shrink"
          />
        }
      >
        <span className="truncate">{shown}</span>
        <ChevronDownIcon
          className={
            bare
              ? "hidden text-muted-foreground group-hover/setting:block group-data-popup-open/setting:block"
              : "text-muted-foreground"
          }
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="max-h-[min(var(--available-height),20rem)] w-auto min-w-40"
      >
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onPick}>
          {groups.map((group, index) => (
            <Fragment key={group.id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                {group.label === undefined ? null : (
                  <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                )}
                {group.options.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled ?? false}
                  >
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A place to send a request: an agent, on one of its models when it lists them. */
interface Destination extends Option {
  agent: AgentChoice;
  model?: string;
}

/**
 * Where a request can go, in one list as Aside and the Codex app have it: each agent's models under
 * its name. An agent that lists no models shows by name, and one that is not installed shows but
 * cannot be picked. Copying a prompt shows only while it is the choice, as it is when no agent is
 * installed, so the picker still names it.
 */
function destinations(
  statuses: ReadonlyArray<AgentStatus> | undefined,
  chosen: AgentChoice,
  t: Messages,
): ReadonlyArray<OptionGroup<Destination>> {
  const agents = AGENTS.map(({ agent, label }): OptionGroup<Destination> => {
    const models = statusOf(statuses, agent)?.models ?? [];
    const installed = agentInstalled(statuses, agent);

    if (!installed || models.length === 0) {
      return { id: agent, options: [{ value: agent, label, agent, disabled: !installed }] };
    }

    return {
      id: agent,
      label,
      options: models.map((option) => ({
        value: `${agent}/${option.id}`,
        label: option.label,
        agent,
        model: option.id,
      })),
    };
  });

  if (chosen !== "queue") return agents;

  return [
    ...agents,
    { id: "queue", options: [{ value: "queue", label: t.composer.queue, agent: "queue" }] },
  ];
}

interface ModelPickerProps {
  statuses: ReadonlyArray<AgentStatus> | undefined;
  agent: AgentChoice;
  picks: ModelPicks;
  onAgent: (agent: AgentChoice) => void;
  onPick: (agent: AgentName, settings: ModelSettings) => void;
}

/**
 * Where a request goes, by the model's name alone, and the reasoning effort it runs with. Picking
 * another agent's model sends to that agent, and a model that does not take the chosen effort moves
 * the effort to one it does.
 */
export function ModelPicker({ statuses, agent, picks, onAgent, onPick }: ModelPickerProps) {
  const t = useMessages();
  const m = t.composer.models;
  const groups = destinations(statuses, agent, t);
  const runner = agent === "queue" ? undefined : agent;
  const status = runner === undefined ? undefined : statusOf(statuses, runner);
  const settings = pickedSettings(statuses, picks, agent);

  const efforts = status === undefined ? [] : effortsFor(status, settings.model);

  function send(value: string) {
    const picked = groups
      .flatMap((group) => group.options)
      .find((option) => option.value === value);

    if (picked === undefined) return;
    onAgent(picked.agent);

    if (picked.agent !== "queue" && picked.model !== undefined) {
      const next = { ...picks[picked.agent], model: picked.model };

      onPick(picked.agent, usableSettings(statusOf(statuses, picked.agent), next));
    }
  }

  return (
    <>
      <Setting
        label={t.composer.agent}
        value={
          runner === undefined || settings.model === undefined
            ? agent
            : `${agent}/${settings.model}`
        }
        groups={groups}
        bare
        onPick={send}
      />
      {runner !== undefined && status !== undefined && efforts.length > 0 ? (
        <Setting
          label={m.effort}
          value={settings.effort}
          groups={[
            {
              id: "efforts",
              options: efforts.map((effort) => ({ value: effort, label: effortLabel(effort, t) })),
            },
          ]}
          onPick={(effort) => onPick(runner, usableSettings(status, { ...settings, effort }))}
        />
      ) : null}
    </>
  );
}
