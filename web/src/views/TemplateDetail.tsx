import { Option } from "effect";
import { CopyIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { SelectionArea } from "@/components/selection-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { safeHttpUrl } from "@/lib/utils";

import type { Format, FormatStatus } from "../api.ts";
import { useMessages } from "../i18n/index.ts";
import { copyText } from "../lib/clipboard.ts";
import { fixPrompt, missingFiles, templateState } from "../lib/templates.ts";
import { TemplateInputs } from "./TemplateInputs.tsx";

export function TemplateDetail({
  status,
  root,
}: {
  status: FormatStatus;
  root: string | undefined;
}) {
  const t = useMessages();
  const state = templateState(status);
  const { format, check } = status;
  const doc = format?.doc;

  return (
    <SelectionArea render={<Card />}>
      <CardHeader>
        <CardTitle>{doc?.title ?? status.id}</CardTitle>
        <CardDescription>{doc?.summary || `formats/${status.id}`}</CardDescription>
        {state === "ready" || root === undefined ? null : (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyText(fixPrompt(status.id, root), t.templates.promptCopied)}
            >
              <CopyIcon data-icon="inline-start" />
              {t.templates.copyFix}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6 text-sm">
          {check.problems.length === 0 ? null : (
            <Alert variant={state === "broken" ? "destructive" : "default"}>
              <TriangleAlertIcon />
              <AlertTitle>
                {state === "broken" ? t.templates.brokenTitle : t.templates.incompleteTitle}
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {check.problems.map((p) => (
                    <li key={`${p.kind}:${p.subject}:${p.message}`}>{p.message}</li>
                  ))}
                </ul>
                <p>{t.templates.fixHint}</p>
              </AlertDescription>
            </Alert>
          )}
          {format === undefined ? null : <FormatBody format={format} status={status} />}
        </div>
      </CardContent>
    </SelectionArea>
  );
}

function FormatBody({ format, status }: { format: Format; status: FormatStatus }) {
  const t = useMessages();
  const { doc } = format;

  return (
    <>
      <FormatBadges doc={doc} />
      <FormatFacts doc={doc} skills={status.check.skills} />
      <TemplateInputs inputs={doc.inputs} dir={format.dir} missing={missingFiles(status)} />
      <ListSection title={t.templates.structure} items={doc.structure} ordered />
      <ListSection title={t.templates.hookRules} items={doc.hookRules} />
      <ListSection title={t.templates.checklist} items={doc.checklist} />

      {format.readme === undefined ? null : (
        <>
          <Separator />
          <div className="typeset typeset-docs">
            <Markdown remarkPlugins={[remarkGfm]}>{format.readme}</Markdown>
          </div>
        </>
      )}
    </>
  );
}

function FormatBadges({ doc }: { doc: Format["doc"] }) {
  const t = useMessages();

  return (
    <div className="flex flex-wrap gap-1.5">
      {doc.aspects.map((aspect) => (
        <Badge key={aspect} variant="secondary">
          {aspect}
        </Badge>
      ))}
      {doc.duration === undefined ? null : (
        <Badge variant="secondary">
          {t.templates.duration(doc.duration.min, doc.duration.max)}
        </Badge>
      )}
      {doc.requireAudio ? <Badge variant="secondary">{t.templates.needsAudio}</Badge> : null}
      {doc.references.map((r) => (
        <Badge key={r} variant="outline">
          {r}
        </Badge>
      ))}
    </div>
  );
}

function FormatFacts({
  doc,
  skills,
}: {
  doc: Format["doc"];
  skills: FormatStatus["check"]["skills"];
}) {
  const t = useMessages();

  if (doc.skills.length + doc.requires.length === 0 && doc.source === undefined) return null;

  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2">
      {doc.skills.length === 0 ? null : (
        <Fact label={t.templates.skills}>
          {doc.skills.map((skill) => {
            const installed = skills[skill.name] !== undefined;

            return (
              <Badge
                key={skill.name}
                variant={installed ? "outline" : "destructive"}
                title={installed ? t.templates.installed : t.templates.missing}
              >
                {skill.name}
              </Badge>
            );
          })}
        </Fact>
      )}
      {doc.requires.length === 0 ? null : (
        <Fact label={t.templates.programs}>
          {doc.requires.map((program) => (
            <code key={program}>{program}</code>
          ))}
        </Fact>
      )}
      {doc.source?.url === undefined ? null : (
        <Fact label={t.templates.source}>
          <SourceLink url={doc.source.url} />
        </Fact>
      )}
      {doc.source?.author === undefined ? null : (
        <Fact label={t.templates.author}>{doc.source.author}</Fact>
      )}
      {doc.source?.license === undefined ? null : (
        <Fact label={t.templates.license}>{doc.source.license}</Fact>
      )}
    </dl>
  );
}

/** A label and its value, in the two-column list of what a template needs and where it came from. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</dd>
    </>
  );
}

function SourceLink({ url }: { url: string }) {
  const safe = safeHttpUrl(url);

  return Option.isSome(safe) ? (
    <a
      href={safe.value}
      target="_blank"
      rel="noreferrer noopener"
      className="truncate underline underline-offset-4"
    >
      {url}
    </a>
  ) : (
    <span className="truncate">{url}</span>
  );
}

function ListSection({
  title,
  items,
  ordered = false,
}: {
  title: string;
  items: ReadonlyArray<string>;
  ordered?: boolean;
}) {
  if (items.length === 0) return null;

  const Tag = ordered ? "ol" : "ul";

  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="font-medium">{title}</h2>
      <Tag className={`${ordered ? "list-decimal" : "list-disc"} pl-5 text-muted-foreground`}>
        {items.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </Tag>
    </section>
  );
}
