import { CheckIcon, FolderOpenIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AgentPermissions } from "@/components/agent-permissions";
import { McpServersCard } from "@/components/mcp-servers";
import { OutdatedAgentNote } from "@/components/outdated-agent";
import { ErrorAlert, Page } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TrustCard } from "@/components/workspace-trust";

import { api, type AgentStatus } from "../api.ts";
import { desktop } from "../desktop.ts";
import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { type PermissionView, permissionsApi } from "../permissionsApi.ts";

/** Settings: the agents and what their runs may do, the workspace folder, and the tools for video work. */
export function Setup() {
  const t = useMessages();
  const { data: agents, error: agentsError, reload } = useLive("agents", api.agents);
  const { data: ws } = useLive("workspace", api.workspace);

  const { data: permissions, error: permissionsError } = useLive(
    "agent-permissions",
    permissionsApi.list,
  );

  return (
    <Page width="narrow" title={t.setup.title} description={t.setup.description}>
      <TrustCard />
      <Card>
        <CardHeader>
          <CardTitle>{t.setup.connectTitle}</CardTitle>
          <CardDescription>{t.setup.connectBody}</CardDescription>
        </CardHeader>
        <CardContent>
          {agentsError ? (
            <ErrorAlert title={t.setup.agentsError} message={agentsError} />
          ) : agents === undefined ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ItemGroup>
                {agents.map((a) => (
                  <AgentRow
                    key={a.agent}
                    status={a}
                    permissions={permissions?.find((p) => p.agent === a.agent)}
                    onChange={reload}
                  />
                ))}
              </ItemGroup>
              {permissionsError ? (
                <ErrorAlert title={t.permissions.error} message={permissionsError} />
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{t.setup.workspaceTitle}</CardTitle>
          <CardDescription>{t.setup.workspaceBody}</CardDescription>
        </CardHeader>
        <CardContent>
          {ws === undefined ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="flex flex-col gap-4">
              <SelectionArea
                render={<dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm" />}
              >
                <dt className="text-muted-foreground">{t.setup.name}</dt>
                <dd>{ws.name}</dd>
                <dt className="text-muted-foreground">{t.setup.folder}</dt>
                <dd className="font-mono text-xs break-all">{ws.root}</dd>
                <dt className="text-muted-foreground">{t.setup.defaultAgent}</dt>
                <dd>{t.setup.agents[ws.config.agent.default]}</dd>
              </SelectionArea>
              {desktop ? (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      desktop
                        ?.revealPath(ws.root)
                        .catch((cause: Error) => toast.error(cause.message))
                    }
                  >
                    <FolderOpenIcon data-icon="inline-start" />
                    {t.setup.showFolder}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
      <McpServersCard />
    </Page>
  );
}

interface AgentRowProps {
  status: AgentStatus;
  /** How its runs may act, once read. */
  permissions: PermissionView | undefined;
  onChange: () => void;
}

function AgentRow({ status, permissions, onChange }: AgentRowProps) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string }>();
  const t = useMessages();
  const label = t.setup.agents[status.agent];

  const connect = () => {
    setBusy(true);
    setOutcome(undefined);
    api
      .connectAgent(status.agent)
      .then((result) => {
        setOutcome(result);

        if (result.ok) toast.success(t.setup.connected(label));
        else toast.error(t.setup.connectFailed(label));
        onChange();
      })
      .catch((cause: Error) => {
        setOutcome({ ok: false, detail: cause.message });
        toast.error(t.setup.connectFailed(label));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
        <ItemDescription>
          {status.connected
            ? t.setup.agentReady
            : status.installed
              ? t.setup.agentFound
              : t.setup.agentMissing}
        </ItemDescription>
        <OutdatedAgentNote status={status} className="text-xs text-muted-foreground" />
        {outcome ? (
          <SelectionArea
            render={
              <p
                className={`text-xs ${outcome.ok ? "text-muted-foreground" : "text-destructive"}`}
              />
            }
          >
            {outcome.detail}
          </SelectionArea>
        ) : null}
      </ItemContent>
      <ItemActions>
        {status.connected ? (
          <Badge variant="secondary">
            <CheckIcon />
            {t.setup.connectedBadge}
          </Badge>
        ) : status.installed ? (
          <Button disabled={busy} onClick={connect}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? t.setup.connecting : t.setup.connect}
          </Button>
        ) : (
          <Badge variant="outline">{t.setup.notInstalled}</Badge>
        )}
      </ItemActions>
      {status.installed && permissions !== undefined ? (
        <ItemFooter>
          <div className="w-full border-t pt-3">
            <AgentPermissions view={permissions} />
          </div>
        </ItemFooter>
      ) : null}
    </Item>
  );
}
