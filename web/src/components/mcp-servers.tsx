import { useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { type McpServerView, mcpApi } from "../mcpApi.ts";

/**
 * The MCP servers the user set up for Claude Code and Codex, each off for runs from the board
 * until the user turns it on. Nothing while there are none.
 */
export function McpServersCard() {
  const t = useMessages();
  const { data: status, error, reload } = useLive("mcp-servers", mcpApi.servers);

  if (error !== undefined) return <ErrorAlert title={t.mcp.error} message={error} />;

  if (status === undefined || (status.servers.length === 0 && status.problems.length === 0)) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.mcp.title}</CardTitle>
        <CardDescription>{t.mcp.body}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {status.problems.length > 0 ? (
            <Alert variant="destructive">
              <AlertTitle>{t.mcp.problems}</AlertTitle>
              <AlertDescription>
                <SelectionArea render={<ul className="list-disc pl-4" />}>
                  {status.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </SelectionArea>
              </AlertDescription>
            </Alert>
          ) : null}
          <ItemGroup>
            {status.servers.map((server) => (
              <ServerRow
                key={`${server.agent}\0${server.name}`}
                server={server}
                onChange={reload}
              />
            ))}
          </ItemGroup>
        </div>
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">{t.mcp.footnote}</p>
      </CardFooter>
    </Card>
  );
}

function ServerRow({ server, onChange }: { server: McpServerView; onChange: () => void }) {
  const t = useMessages();
  const [busy, setBusy] = useState<boolean>();
  const pending = server.state === "new" || server.state === "changed";

  const decide = (on: boolean) => {
    setBusy(on);
    mcpApi
      .decide({ agent: server.agent, name: server.name, fingerprint: server.fingerprint, on })
      .then(() => toast.success(on ? t.mcp.turnedOn(server.name) : t.mcp.turnedOff(server.name)))
      .catch((cause: Error) =>
        toast.error(t.mcp.failed(server.name), { description: cause.message }),
      )
      .finally(() => {
        setBusy(undefined);
        onChange();
      });
  };

  const button = (on: boolean, label: string, variant: "default" | "outline" | "ghost") => (
    <Button size="sm" variant={variant} disabled={busy !== undefined} onClick={() => decide(on)}>
      {busy === on ? <Spinner data-icon="inline-start" /> : null}
      {label}
    </Button>
  );

  return (
    <Item variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          <span className="font-mono">{server.name}</span>
          <Badge variant="outline">{t.setup.agents[server.agent]}</Badge>
          <Badge variant="outline">{t.mcp.sources[server.source]}</Badge>
          <Badge variant={server.state === "on" ? "secondary" : pending ? "default" : "outline"}>
            {t.mcp.states[server.state]}
          </Badge>
        </ItemTitle>
        {server.state === "changed" ? <ItemDescription>{t.mcp.changedNote}</ItemDescription> : null}
        <SelectionArea render={<div className="flex flex-col gap-1 text-xs" />}>
          <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono break-all whitespace-pre-wrap">
            {server.launch}
          </pre>
          <Names label={t.mcp.env} names={server.env} />
          <Names label={t.mcp.headers} names={server.headers} />
          {server.helper === undefined ? null : (
            <p>
              <span className="text-muted-foreground">{t.mcp.helper}: </span>
              <span className="font-mono break-all">{server.helper}</span>
            </p>
          )}
        </SelectionArea>
      </ItemContent>
      <ItemActions>
        {server.state === "on" ? button(false, t.mcp.turnOff, "outline") : null}
        {server.state === "off" ? button(true, t.mcp.turnOn, "outline") : null}
        {pending ? button(false, t.mcp.keepOff, "ghost") : null}
        {pending ? button(true, t.mcp.turnOn, "default") : null}
      </ItemActions>
    </Item>
  );
}

/** The names of what a server is given, never their values; nothing when there are none. */
function Names({ label, names }: { label: string; names: ReadonlyArray<string> }) {
  if (names.length === 0) return null;

  return (
    <p>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-mono break-all">{names.join(", ")}</span>
    </p>
  );
}
