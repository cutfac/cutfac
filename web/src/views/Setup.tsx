import { CheckIcon, FolderOpenIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AgentPermissions } from "@/components/agent-permissions";
import { ErrorReportsCard } from "@/components/error-reports";
import { McpServersCard } from "@/components/mcp-servers";
import { OutdatedAgentNote } from "@/components/outdated-agent";
import { ErrorAlert, Page, Section } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { errorText, sendFailed } from "../lib/notify.ts";
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
      <Section title={t.setup.connectTitle} description={t.setup.connectBody}>
        {agentsError ? (
          <div className="py-3">
            <ErrorAlert title={t.setup.agentsError} message={agentsError} />
          </div>
        ) : agents === undefined ? (
          <div className="flex flex-col gap-2 py-3" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <ItemGroup>
            {agents.map((a) => (
              <AgentRow
                key={a.agent}
                status={a}
                permissions={permissions?.find((p) => p.agent === a.agent)}
                onChange={reload}
              />
            ))}
            {permissionsError ? (
              <div className="pb-3">
                <ErrorAlert title={t.permissions.error} message={permissionsError} />
              </div>
            ) : null}
          </ItemGroup>
        )}
      </Section>

      <Section title={t.setup.workspaceTitle} description={t.setup.workspaceBody}>
        {ws === undefined ? (
          <Skeleton className="my-3 h-24 w-full" />
        ) : (
          <ItemGroup>
            <Item variant="row">
              <ItemContent>
                <ItemTitle>{t.setup.name}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <SelectionArea render={<span className="text-sm" />}>{ws.name}</SelectionArea>
              </ItemActions>
            </Item>
            <Item variant="row" className="flex-nowrap">
              <ItemContent className="min-w-0">
                <ItemTitle>{t.setup.folder}</ItemTitle>
                <SelectionArea
                  render={<p className="font-mono text-xs break-all text-muted-foreground" />}
                >
                  {ws.root}
                </SelectionArea>
              </ItemContent>
              {desktop ? (
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => desktop?.revealPath(ws.root).catch(sendFailed)}
                  >
                    <FolderOpenIcon data-icon="inline-start" />
                    {t.setup.showFolder}
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
            <Item variant="row">
              <ItemContent>
                <ItemTitle>{t.setup.defaultAgent}</ItemTitle>
              </ItemContent>
              <ItemActions>
                <span className="text-sm">{t.setup.agents[ws.config.agent.default]}</span>
              </ItemActions>
            </Item>
          </ItemGroup>
        )}
      </Section>
      <McpServersCard />
      <ErrorReportsCard />
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
      .catch((cause) => {
        setOutcome({ ok: false, detail: errorText(cause) });
        toast.error(t.setup.connectFailed(label));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Item variant="row">
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
          <div className="w-full">
            <AgentPermissions view={permissions} />
          </div>
        </ItemFooter>
      ) : null}
    </Item>
  );
}
