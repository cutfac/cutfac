import { TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";

import { FieldError } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { type Messages, useMessages } from "../i18n/index.ts";
import { errorText } from "../lib/notify.ts";
import {
  type Access,
  type PermissionMode,
  type PermissionView,
  permissionsApi,
} from "../permissionsApi.ts";

const MODES: ReadonlyArray<PermissionMode> = ["follow", "edit", "auto", "full"];

/** Access that asks the user to look twice: anything on the computer, or too little to edit. */
const warns = (access: Access) => access === "full" || access === "limited";

/** What `access` comes to for runs of an agent named `name`. */
function accessText(access: Access, name: string, t: Messages) {
  switch (access) {
    case "asks":
    case "auto":
      return t.permissions.access[access](name);
    case "edit":
    case "unasked":
    case "full":
    case "limited":
      return t.permissions.access[access];
  }
}

/** How much an agent's runs from the board may do, as the user picks it, and what that comes to. */
export function AgentPermissions({ view }: { view: PermissionView }) {
  const t = useMessages();
  const id = useId();
  // What the last choice kept, until a fresh read of `view` takes over.
  const [kept, setKept] = useState<{ from: PermissionView; view: PermissionView }>();
  const [busy, setBusy] = useState<PermissionMode>();
  const [failure, setFailure] = useState<string>();
  const shown = kept?.from === view ? kept.view : view;
  const mode = busy ?? shown.mode;
  const access = mode === "follow" ? shown.follows : mode;
  const agent = t.setup.agents[view.agent];
  const items = MODES.map((value) => ({ value, label: t.permissions.modes[value] }));

  const choose = (next: PermissionMode) => {
    setBusy(next);
    setFailure(undefined);
    permissionsApi
      .set({ agent: view.agent, mode: next })
      .then((chosen) => setKept({ from: view, view: chosen }))
      .catch((cause) => setFailure(`${t.permissions.failed(agent)}: ${errorText(cause)}`))
      .finally(() => setBusy(undefined));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span id={id} className="text-sm font-medium">
          {t.permissions.label}
        </span>
        <Select
          items={items}
          value={mode}
          readOnly={busy !== undefined}
          onValueChange={(next) => {
            if (next !== null && next !== shown.mode) choose(next);
          }}
        >
          <SelectTrigger size="sm" aria-labelledby={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p
        className={`flex items-start gap-1.5 text-xs ${warns(access) ? "font-medium" : "text-muted-foreground"}`}
      >
        {warns(access) ? <TriangleAlertIcon className="mt-px size-3.5 shrink-0" /> : null}
        <span>
          {mode === "follow"
            ? `${t.permissions.followed(agent, shown.setting !== undefined)} `
            : null}
          {accessText(access, agent, t)}
        </span>
      </p>
      <FieldError className="select-text">{failure}</FieldError>
    </div>
  );
}
