import { ChevronRightIcon, PuzzleIcon } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import {
  type McpLaunchView,
  type McpPluginView,
  type McpServerView,
  type McpState,
  mcpApi,
} from "../mcpApi.ts";

/**
 * The MCP servers the user set up for Claude Code and Codex, and the plugins that bring some,
 * each off for runs from the board until the user turns it on. Nothing while there are none.
 */
export function McpServersCard() {
  const t = useMessages();
  const { data: status, error, reload } = useLive("mcp-servers", mcpApi.servers);

  if (error !== undefined) return <ErrorAlert title={t.mcp.error} message={error} />;

  if (
    status === undefined ||
    (status.servers.length === 0 && status.plugins.length === 0 && status.problems.length === 0)
  ) {
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
            {status.plugins.map((plugin) => (
              <PluginRow key={`${plugin.agent}\0${plugin.id}`} plugin={plugin} onChange={reload} />
            ))}
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

/** Waiting for the user: never decided on, or changed since they turned it on. */
const waits = (state: McpState) => state === "new" || state === "changed";

function StateBadge({ state }: { state: McpState }) {
  const t = useMessages();

  return (
    <Badge variant={state === "on" ? "secondary" : waits(state) ? "default" : "outline"}>
      {t.mcp.states[state]}
    </Badge>
  );
}

function PluginRow({ plugin, onChange }: { plugin: McpPluginView; onChange: () => void }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const { agent, id, fingerprint, title } = plugin;

  return (
    <Item variant="outline">
      <ItemMedia variant="image">
        {plugin.logo === undefined ? (
          <div className="flex size-full items-center justify-center bg-muted">
            <PuzzleIcon className="size-5 text-muted-foreground" />
          </div>
        ) : (
          <img src={plugin.logo} alt="" />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          {waits(plugin.state) ? t.mcp.plugin.ask(title) : title}
          <Badge variant="outline">{t.setup.agents[agent]}</Badge>
          <StateBadge state={plugin.state} />
        </ItemTitle>
        {plugin.description === undefined ? null : (
          <ItemDescription>{plugin.description}</ItemDescription>
        )}
        <ItemDescription>{t.mcp.plugin.access(title)}</ItemDescription>
        {plugin.state === "changed" ? <ItemDescription>{t.mcp.changedNote}</ItemDescription> : null}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="-ml-2" />}>
            {t.mcp.plugin.starts(plugin.servers.length)}
            <ChevronRightIcon data-icon="inline-end" className={open ? "rotate-90" : undefined} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 flex flex-col gap-3">
              {plugin.servers.map((server) => (
                <Launch key={server.name} name={server.name} server={server} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </ItemContent>
      <Decision
        state={plugin.state}
        labels={{ on: t.mcp.plugin.use, off: t.mcp.plugin.skip, skip: t.mcp.plugin.skip }}
        send={(on) => mcpApi.decidePlugin({ agent, id, fingerprint, on })}
        done={(on) => (on ? t.mcp.plugin.turnedOn(title) : t.mcp.plugin.turnedOff(title))}
        failed={t.mcp.failed(title)}
        onChange={onChange}
      />
    </Item>
  );
}

function ServerRow({ server, onChange }: { server: McpServerView; onChange: () => void }) {
  const t = useMessages();
  const { agent, name, fingerprint } = server;

  return (
    <Item variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap">
          <span className="font-mono">{name}</span>
          <Badge variant="outline">{t.setup.agents[agent]}</Badge>
          <Badge variant="outline">{t.mcp.sources[server.source]}</Badge>
          <StateBadge state={server.state} />
        </ItemTitle>
        {server.state === "changed" ? <ItemDescription>{t.mcp.changedNote}</ItemDescription> : null}
        <Launch server={server} />
      </ItemContent>
      <Decision
        state={server.state}
        labels={{ on: t.mcp.turnOn, off: t.mcp.turnOff, skip: t.mcp.keepOff }}
        send={(on) => mcpApi.decide({ agent, name, fingerprint, on })}
        done={(on) => (on ? t.mcp.turnedOn(name) : t.mcp.turnedOff(name))}
        failed={t.mcp.failed(name)}
        onChange={onChange}
      />
    </Item>
  );
}

/** How a server starts, named when it's one of several. */
function Launch({ name, server }: { name?: string; server: McpLaunchView }) {
  const t = useMessages();

  return (
    <SelectionArea render={<div className="flex flex-col gap-1 text-xs" />}>
      {name === undefined ? null : <p className="font-mono font-medium">{name}</p>}
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

interface DecisionProps {
  state: McpState;
  /** What the buttons say: to turn it on, to turn it off, and to leave it off while it waits. */
  labels: { on: string; off: string; skip: string };
  send: (on: boolean) => Promise<{ state: McpState }>;
  /** What the toast says once the choice is kept. */
  done: (on: boolean) => string;
  failed: string;
  onChange: () => void;
}

/** The buttons that turn something on or off for runs from the board, as fits its state. */
function Decision({ state, labels, send, done, failed, onChange }: DecisionProps) {
  const [busy, setBusy] = useState<boolean>();

  const decide = (on: boolean) => {
    setBusy(on);
    send(on)
      .then(() => toast.success(done(on)))
      .catch((cause: Error) => toast.error(failed, { description: cause.message }))
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
    <ItemActions>
      {state === "on" ? button(false, labels.off, "outline") : null}
      {state === "off" ? button(true, labels.on, "outline") : null}
      {waits(state) ? button(false, labels.skip, "ghost") : null}
      {waits(state) ? button(true, labels.on, "default") : null}
    </ItemActions>
  );
}
