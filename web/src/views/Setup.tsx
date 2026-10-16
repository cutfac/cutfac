import { cva } from "class-variance-authority";
import { CheckCircle2Icon, CheckIcon, FolderOpenIcon, TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ErrorAlert, Page } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

import { api, type AgentStatus } from "../api.ts";
import { desktop } from "../desktop.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

const markerVariants = cva(
  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
  {
    variants: {
      state: {
        done: "bg-primary text-primary-foreground",
        current: "border-2 border-primary text-foreground",
        todo: "border text-muted-foreground",
      },
    },
    defaultVariants: { state: "todo" },
  },
);

type StepState = "done" | "current" | "todo";

function Step({
  n,
  state,
  title,
  description,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const t = useMessages();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-3">
            <span className={markerVariants({ state })} aria-hidden="true">
              {state === "done" ? <CheckIcon className="size-3.5" /> : n}
            </span>
            {title}
            {state === "done" ? <span className="sr-only">{t.setup.done}</span> : null}
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">{children}</div>
      </CardContent>
    </Card>
  );
}

/** First-run onboarding: connect an agent, then point the factory at the app. */
export function Setup() {
  const t = useMessages();
  const { data: agents, error: agentsError, reload } = useLive("agents", api.agents);
  const { data: ws } = useLive("workspace", api.workspace);
  const connected = agents?.some((a) => a.connected) ?? false;
  const product = ws?.product.doc;
  const hasProduct = Boolean(product && product.name !== "My App");

  return (
    <Page width="narrow" title={t.setup.title} description={t.setup.description}>
      <Step
        n={1}
        state={connected ? "done" : "current"}
        title={t.setup.connectTitle}
        description={t.setup.connectBody}
      >
        {agentsError ? (
          <ErrorAlert title={t.setup.agentsError} message={agentsError} />
        ) : agents === undefined ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <ItemGroup>
            {agents.map((a) => (
              <AgentRow key={a.agent} status={a} onChange={reload} />
            ))}
          </ItemGroup>
        )}
      </Step>

      <Step
        n={2}
        state={hasProduct ? "done" : connected ? "current" : "todo"}
        title={t.setup.productTitle}
        description={t.setup.productBody}
      >
        <ImportForm />
        {hasProduct && product ? (
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>{product.name}</ItemTitle>
              {product.oneLiner ? <ItemDescription>{product.oneLiner}</ItemDescription> : null}
            </ItemContent>
            <ItemActions>
              <a
                href={href("product")}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t.setup.review}
              </a>
            </ItemActions>
          </Item>
        ) : null}
      </Step>

      {connected && hasProduct ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>{t.setup.readyTitle}</AlertTitle>
          <AlertDescription>
            {t.setup.readyBody((text) => (
              <a href={href("board")} className="underline underline-offset-4">
                {text}
              </a>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

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
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t.setup.name}</dt>
                <dd>{ws.name}</dd>
                <dt className="text-muted-foreground">{t.setup.folder}</dt>
                <dd className="font-mono text-xs break-all">{ws.root}</dd>
                <dt className="text-muted-foreground">{t.setup.defaultAgent}</dt>
                <dd>{t.setup.agents[ws.config.agent.default]}</dd>
              </dl>
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
    </Page>
  );
}

function AgentRow({ status, onChange }: { status: AgentStatus; onChange: () => void }) {
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
        {outcome ? (
          <p className={`text-xs ${outcome.ok ? "text-muted-foreground" : "text-destructive"}`}>
            {outcome.detail}
          </p>
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
    </Item>
  );
}

export function ImportForm() {
  const t = useMessages();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const submit = () => {
    const link = url.trim();

    if (!link) return;
    setBusy(true);
    setError(undefined);
    setWarnings([]);
    api
      .importProduct(link)
      .then((result) => {
        setWarnings(result.warnings);
        setUrl("");
        toast.success(t.importForm.imported);
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <Input
          type="url"
          value={url}
          disabled={busy}
          aria-label={t.importForm.link}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t.importForm.placeholder}
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? t.importForm.reading : t.importForm.submit}
        </Button>
      </div>
      {error ? <ErrorAlert title={t.importForm.error} message={error} /> : null}
      {warnings.length > 0 ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>{t.importForm.warnings}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
