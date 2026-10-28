import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorAlert } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

import { api, type AgentChoice, type TrustItem } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { LiveState } from "../lib/live.ts";
import { errorText } from "../lib/notify.ts";

/** A setting as the user reads it: the file's own text when it is not JSON, else its JSON. */
const shown = (item: TrustItem) =>
  "key" in item ? JSON.stringify(item.value, null, 2) : item.value;

/** The setting's name; none for a whole file that is not JSON. */
const keyOf = (item: TrustItem) => ("key" in item ? item.key : undefined);

/**
 * The workspace's Claude Code settings that run or allow commands on their own, for the user to
 * look over and trust. Nothing while there are none, or the user trusts them already.
 */
export function TrustCard() {
  const t = useMessages();
  const { state: load, data: trust, reload } = useLive("trust", api.trust);
  const [busy, setBusy] = useState(false);

  if (LiveState.$is("Failed")(load))
    return <ErrorAlert title={t.trust.error} message={load.error} />;

  if (trust?.needed !== true) return null;

  const trustNow = () => {
    setBusy(true);
    api
      .trustWorkspace(trust.fingerprint)
      .then(() => toast.success(t.trust.trusted))
      .catch((cause) => toast.error(t.trust.failed, { description: errorText(cause) }))
      .finally(() => {
        setBusy(false);
        reload();
      });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.trust.title}</CardTitle>
        <CardDescription>{t.trust.body}</CardDescription>
      </CardHeader>
      <CardContent>
        <SelectionArea render={<ul className="flex flex-col gap-3" />}>
          {trust.items.map((item) => (
            <li key={`${item.file}\0${keyOf(item) ?? ""}`} className="flex flex-col gap-1">
              <p className="text-xs">
                <span className="font-mono">{keyOf(item) ?? t.trust.wholeFile}</span>
                <span className="text-muted-foreground"> · {item.file}</span>
              </p>
              <pre className="max-h-48 overflow-auto rounded-2xl bg-muted px-2.5 py-2 font-mono text-xs">
                {shown(item)}
              </pre>
            </li>
          ))}
        </SelectionArea>
      </CardContent>
      <CardFooter>
        <Button disabled={busy} onClick={trustNow}>
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheckIcon data-icon="inline-start" />
          )}
          {busy ? t.trust.trusting : t.trust.trust}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** Says that Claude waits for the user to trust the workspace's settings; nothing otherwise. */
export function TrustNote({ agent, className }: { agent: AgentChoice; className?: string }) {
  const t = useMessages();
  const { data: trust } = useLive("trust", api.trust);

  if (agent !== "claude" || trust?.needed !== true) return null;

  return (
    <p className={className}>
      {t.trust.note((text) => (
        <a href={href("setup")} className="underline underline-offset-4">
          {text}
        </a>
      ))}
    </p>
  );
}
