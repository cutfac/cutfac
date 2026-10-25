import {
  ChevronRightIcon,
  GlobeIcon,
  type LucideIcon,
  PuzzleIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert, Section } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";

import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import {
  type McpLaunchView,
  type McpPluginView,
  type McpServersStatus,
  type McpServerView,
  type McpState,
  mcpApi,
} from "../mcpApi.ts";

/** What the user turned on or off since `status` was read, by row. */
interface Kept {
  status?: McpServersStatus;
  states: Readonly<Record<string, McpState>>;
}

/**
 * The MCP servers the user set up for Claude Code and Codex, and the plugins that bring some,
 * each off for runs from the board until the user turns it on. The list folds into one line of how
 * many there are and how many are in use, opened to review them. Nothing while there are none.
 */
export function McpServersCard() {
  const t = useMessages();
  const { data: status, error, reload } = useLive("mcp-servers", mcpApi.servers);
  const [kept, setKept] = useState<Kept>({ states: {} });
  const [open, setOpen] = useState(false);

  if (error !== undefined) return <ErrorAlert title={t.mcp.error} message={error} />;

  if (
    status === undefined ||
    (status.servers.length === 0 && status.plugins.length === 0 && status.problems.length === 0)
  ) {
    return null;
  }

  // A fresh read already has what the user chose.
  const states = kept.status === status ? kept.states : {};

  const keep = (key: string) => (state: McpState | undefined) => {
    if (state === undefined) return reload();

    setKept((previous) => {
      const next: Record<string, McpState> =
        previous.status === status ? { ...previous.states } : {};

      next[key] = state;

      return { status, states: next };
    });
  };

  // What waits for the user comes first; the rest keep their place as they're switched.
  const rows = [
    ...status.plugins.map((plugin) => {
      const key = `plugin\0${plugin.agent}\0${plugin.id}`;
      const state = states[key] ?? plugin.state;

      return {
        state,
        row: <PluginRow key={key} plugin={plugin} state={state} kept={keep(key)} />,
      };
    }),
    ...status.servers.map((server) => {
      const key = `server\0${server.agent}\0${server.name}`;
      const state = states[key] ?? server.state;

      return {
        state,
        row: <ServerRow key={key} server={server} state={state} kept={keep(key)} />,
      };
    }),
  ].toSorted((a, b) => Number(waits(b.state)) - Number(waits(a.state)));

  return (
    <Section title={t.mcp.title} description={t.mcp.body} note={t.mcp.footnote}>
      <div className="flex flex-col gap-3 py-3">
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
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.mcp.summary(rows.length)}</p>
              <p className="text-sm text-muted-foreground">
                {t.mcp.inUse(rows.filter(({ state }) => state === "on").length)}
              </p>
            </div>
            <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
              {open ? t.mcp.hide : t.mcp.review}
              <ChevronRightIcon data-icon="inline-end" className={open ? "rotate-90" : undefined} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <ItemGroup className="mt-3">{rows.map(({ row }) => row)}</ItemGroup>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </Section>
  );
}

/** Waiting for the user: never decided on, or changed since they turned it on. */
const waits = (state: McpState) => state === "new" || state === "changed";

interface RowProps {
  state: McpState;
  /** Told what the user's choice left it as, or nothing when it couldn't be kept. */
  kept: (state: McpState | undefined) => void;
}

function PluginRow({ plugin, state, kept }: RowProps & { plugin: McpPluginView }) {
  const t = useMessages();
  const { agent, id, fingerprint, title } = plugin;

  return (
    <McpRow
      media={
        plugin.logo === undefined ? (
          <IconTile icon={PuzzleIcon} />
        ) : (
          <img src={plugin.logo} alt="" />
        )
      }
      name={title}
      ask={t.mcp.plugin.ask(title)}
      about={[t.setup.agents[agent], plugin.description].filter(Boolean).join(" · ")}
      access={t.mcp.plugin.access(title)}
      state={state}
      decision={{
        send: (on) => mcpApi.decidePlugin({ agent, id, fingerprint, on }),
        done: (on) => (on ? t.mcp.plugin.turnedOn(title) : t.mcp.plugin.turnedOff(title)),
        failed: t.mcp.plugin.failed(title),
        kept,
      }}
    >
      {plugin.servers.map((server) => (
        <Launch
          key={server.name}
          name={plugin.servers.length > 1 ? server.name : undefined}
          server={server}
        />
      ))}
    </McpRow>
  );
}

function ServerRow({ server, state, kept }: RowProps & { server: McpServerView }) {
  const t = useMessages();
  const { agent, name, fingerprint } = server;

  return (
    <McpRow
      media={<IconTile icon={server.kind === "url" ? GlobeIcon : TerminalIcon} />}
      name={name}
      ask={t.mcp.server.ask(name)}
      about={`${t.setup.agents[agent]} · ${t.mcp.sources[server.source]}`}
      access={t.mcp.server.access}
      state={state}
      decision={{
        send: (on) => mcpApi.decide({ agent, name, fingerprint, on }),
        done: (on) => (on ? t.mcp.server.turnedOn(name) : t.mcp.server.turnedOff(name)),
        failed: t.mcp.server.failed(name),
        kept,
      }}
    >
      <Launch server={server} />
    </McpRow>
  );
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex size-full items-center justify-center bg-muted">
      <Icon className="size-5 text-muted-foreground" />
    </div>
  );
}

interface McpRowProps {
  media: ReactNode;
  name: string;
  /** The title while it waits for the user. */
  ask: string;
  /** Which agent it's for and what it is, as one line. */
  about: string;
  /** What turning it on gives the agent, said while it waits. */
  access: string;
  state: McpState;
  decision: Omit<DecisionProps, "name" | "state">;
  /** How it starts. */
  children: ReactNode;
}

/** A server or plugin as the user turns it on or off, with what it runs folded away. */
function McpRow({ media, name, ask, about, access, state, decision, children }: McpRowProps) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const pending = waits(state);

  return (
    <Item variant="row">
      <ItemMedia variant="image">{media}</ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle>{pending ? ask : name}</ItemTitle>
        <ItemDescription>{about}</ItemDescription>
        {pending ? <ItemDescription>{access}</ItemDescription> : null}
        {state === "changed" ? (
          <p className="flex items-start gap-1.5 text-sm font-medium">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            {t.mcp.changedNote}
          </p>
        ) : null}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger render={<Button variant="ghost" size="xs" className="-ml-2" />}>
            {t.mcp.starts}
            <ChevronRightIcon data-icon="inline-end" className={open ? "rotate-90" : undefined} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1.5 flex flex-col gap-3">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      </ItemContent>
      <Decision name={name} state={state} {...decision} />
    </Item>
  );
}

/** How a server starts, named when it's one of several. */
function Launch({ name, server }: { name?: string | undefined; server: McpLaunchView }) {
  const t = useMessages();

  return (
    <SelectionArea render={<div className="flex flex-col gap-1 text-xs" />}>
      {name === undefined ? null : <p className="font-medium">{name}</p>}
      <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono wrap-break-word whitespace-pre-wrap">
        {server.launch}
      </pre>
      <Names label={t.mcp.env} names={server.env} />
      <Names label={t.mcp.headers} names={server.headers} />
      {server.helper === undefined ? null : (
        <p>
          <span className="text-muted-foreground">{t.mcp.helper}: </span>
          <span className="font-mono wrap-break-word">{server.helper}</span>
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
      <span className="font-mono wrap-break-word">{names.join(", ")}</span>
    </p>
  );
}

interface DecisionProps {
  name: string;
  state: McpState;
  send: (on: boolean) => Promise<{ state: McpState }>;
  /** What the toast says once the choice is kept. */
  done: (on: boolean) => string;
  failed: string;
  kept: (state: McpState | undefined) => void;
}

/**
 * The question's two answers while it waits for the user, and a switch once they've answered,
 * which keeps the keyboard focus where the answer was.
 */
function Decision({ name, state, send, done, failed, kept }: DecisionProps) {
  const t = useMessages();
  const [busy, setBusy] = useState<boolean>();
  const actions = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  const pending = waits(state);

  useEffect(() => {
    if (pending || !refocus.current) return;

    refocus.current = false;
    toggle.current?.focus();
  }, [pending]);

  const decide = (on: boolean) => {
    refocus.current = actions.current?.contains(document.activeElement) === true;
    setBusy(on);
    send(on)
      .then((view) => {
        toast.success(done(on));
        kept(view.state);
      })
      .catch((cause: Error) => {
        toast.error(failed, { description: cause.message });
        kept(undefined);
      })
      .finally(() => setBusy(undefined));
  };

  const answer = (on: boolean, label: string, variant: "default" | "ghost") => (
    <Button
      size="sm"
      variant={variant}
      disabled={busy !== undefined}
      focusableWhenDisabled
      onClick={() => decide(on)}
    >
      {busy === on ? <Spinner data-icon="inline-start" /> : null}
      {label}
    </Button>
  );

  return (
    <ItemActions ref={actions} className="self-start">
      {pending ? (
        <>
          {answer(false, t.mcp.skip, "ghost")}
          {answer(true, t.mcp.use, "default")}
        </>
      ) : (
        <Switch
          ref={toggle}
          aria-label={t.mcp.toggle(name)}
          checked={busy ?? state === "on"}
          readOnly={busy !== undefined}
          onCheckedChange={decide}
        />
      )}
    </ItemActions>
  );
}
