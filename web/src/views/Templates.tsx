import {
  CopyIcon,
  DownloadIcon,
  LayoutTemplateIcon,
  LinkIcon,
  PaperclipIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { HeldChips, useHeldFiles } from "@/components/editor/attachments";
import { ImportChat } from "@/components/import-chat";
import { ImportName } from "@/components/import-source";
import { ErrorAlert, ListSkeleton, Page } from "@/components/page";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Dropzone } from "@/components/ui/dropzone";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { TrustNote } from "@/components/workspace-trust";
import { safeHttpUrl } from "@/lib/utils";

import {
  api,
  fileUrl,
  type AgentName,
  type Format,
  type FormatStatus,
  type ImportDetail,
  type ImportSummary,
  type InputChoice,
  type InputField,
  type WorkspaceInfo,
} from "../api.ts";
import { agentInstalled, href, useAgentStatuses, useLive } from "../hooks.ts";
import { messages, useLocale, useMessages } from "../i18n/index.ts";
import { importAgent, importIdOf, importRouteId, importState, isWorking } from "../lib/imports.ts";
import { AGENTS } from "../lib/models.ts";
import { NO_RUN } from "../lib/run.ts";
import {
  coverOf,
  fixPrompt,
  importPrompt,
  isClip,
  missingFiles,
  sortTemplates,
  templateState,
} from "../lib/templates.ts";

function copyText(text: string, done: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(done))
    .catch((cause: Error) => toast.error(messages().common.couldNotCopy(cause.message)));
}

interface AddTemplateProps {
  ws: WorkspaceInfo;
  /** An import started; the list should show it. */
  onStarted: () => void;
  /** Small in the title bar. */
  size?: "sm" | "default";
}

/**
 * Bringing a template in is the agent's job: the board runs the user's agent on a link to any
 * template, skill, or post it can read, or turns the link into a prompt to paste into one.
 */
function AddTemplate({ ws, onStarted, size = "default" }: AddTemplateProps) {
  const [open, setOpen] = useState(false);
  const t = useMessages();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size={size}>
            <PlusIcon data-icon="inline-start" />
            {t.templates.add}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.templates.addTitle}</DialogTitle>
          <DialogDescription>{t.templates.addBody}</DialogDescription>
        </DialogHeader>
        <AddTemplateForm
          ws={ws}
          onStarted={(detail) => {
            setOpen(false);
            onStarted();
            location.hash = href("templates", importRouteId(detail.id));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog's form. It mounts with the dialog, so each opening starts empty and reads which
 * agents are installed afresh: the user may have just connected one. Files dropped or pasted on
 * it go to the agent with the link.
 */
function AddTemplateForm({
  ws,
  onStarted,
}: {
  ws: WorkspaceInfo;
  onStarted: (detail: ImportDetail) => void;
}) {
  const statuses = useAgentStatuses();
  const [link, setLink] = useState("");
  const [chosen, setChosen] = useState<AgentName | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const files = useHeldFiles();
  const openFiles = useRef<() => void>(null);
  const agent = chosen ?? importAgent(ws.config.agent.default, statuses);
  const trimmed = link.trim();
  const locale = useLocale();
  const t = useMessages();

  const agentItems = AGENTS.map(({ agent: value, label }) => ({
    value,
    label,
    disabled: !agentInstalled(statuses, value),
  }));

  async function start(event: FormEvent) {
    event.preventDefault();

    if (trimmed === "" || agent === undefined || sending) return;

    setSending(true);

    try {
      onStarted(await api.startImport({ link: trimmed, agent, locale }, files.uploads));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
      setSending(false);
    }
  }

  return (
    <Dropzone
      paste
      label={t.attachments.drop.withLink}
      openRef={openFiles}
      onFiles={files.add}
      // The outline sits in the dialog's padding, clear of the fields.
      className="-m-3"
    >
      <form className="flex flex-col gap-6 p-3" onSubmit={(event) => void start(event)}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="template-link">{t.templates.link}</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <LinkIcon />
              </InputGroupAddon>
              <InputGroupInput
                id="template-link"
                type="url"
                required
                value={link}
                placeholder={t.templates.linkPlaceholder}
                onChange={(e) => setLink(e.target.value)}
              />
            </InputGroup>
          </Field>
          <Field>
            <FieldTitle>{t.templates.files}</FieldTitle>
            <HeldChips files={files} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => openFiles.current?.()}
            >
              <PaperclipIcon data-icon="inline-start" />
              {t.attachments.attach}
            </Button>
            <FieldDescription>{t.templates.filesHint}</FieldDescription>
          </Field>
          {agent === undefined ? (
            <FieldDescription>
              {t.imports.noAgent((text) => (
                <a href={href("setup")}>{text}</a>
              ))}
            </FieldDescription>
          ) : (
            <Field orientation="horizontal">
              <FieldLabel htmlFor="template-agent">{t.imports.agent}</FieldLabel>
              <Select
                items={agentItems}
                value={agent}
                onValueChange={(value) => {
                  if (value !== null) setChosen(value);
                }}
              >
                <SelectTrigger id="template-agent" className="ml-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {agentItems.map((option) => (
                    <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {agent === undefined ? null : (
            <TrustNote agent={agent} className="text-sm text-muted-foreground" />
          )}
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t.common.close}</DialogClose>
          <Button
            type="button"
            variant="outline"
            disabled={trimmed === ""}
            onClick={() => copyText(importPrompt(trimmed, ws.root), t.templates.promptCopied)}
          >
            <CopyIcon data-icon="inline-start" />
            {t.templates.copyPrompt}
          </Button>
          <Button type="submit" disabled={trimmed === "" || agent === undefined || sending}>
            {sending ? <Spinner data-icon="inline-start" /> : null}
            {t.imports.start}
          </Button>
        </DialogFooter>
      </form>
    </Dropzone>
  );
}

/** How often the list looks again while an import's agent works; the file watcher skips them. */
const IMPORT_POLL_MS = 2000;

export function Templates({ selected }: { selected: string | undefined }) {
  const t = useMessages();
  const { data: statuses, error } = useLive("formats-status", api.formatStatuses);
  const { data: ws } = useLive("workspace", api.workspace);
  const imports = useLive("imports", api.imports);
  const templates = statuses === undefined ? undefined : sortTemplates(statuses);
  const importId = importIdOf(selected);
  const open = imports.data?.filter((detail) => !detail.doc.closed) ?? [];
  const working = open.some((detail) => isWorking(importState(detail, NO_RUN)));
  const reloadImports = useEffectEvent(imports.reload);

  // An import's agent can finish while it is not open; keep its row's state current.
  useEffect(() => {
    if (!working) return;

    const timer = setInterval(() => reloadImports(), IMPORT_POLL_MS);

    return () => clearInterval(timer);
  }, [working]);

  const current =
    importId !== undefined
      ? undefined
      : selected === undefined
        ? templates?.[0]
        : templates?.find((s) => s.id === selected);

  return (
    <Page
      width="wide"
      title={t.templates.title}
      description={t.templates.description}
      actions={
        ws === undefined ? null : <AddTemplate ws={ws} onStarted={imports.reload} size="sm" />
      }
    >
      {error ? (
        <ErrorAlert title={t.templates.loadError} message={error} />
      ) : templates === undefined ? (
        <ListSkeleton rows={4} />
      ) : templates.length === 0 && open.length === 0 && importId === undefined ? (
        <div className="rounded-3xl border border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutTemplateIcon />
              </EmptyMedia>
              <EmptyTitle>{t.templates.emptyTitle}</EmptyTitle>
              <EmptyDescription>
                {t.templates.emptyBody((text) => (
                  <a href={href("learn")}>{text}</a>
                ))}
              </EmptyDescription>
            </EmptyHeader>
            {ws === undefined ? null : (
              <EmptyContent>
                <AddTemplate ws={ws} onStarted={imports.reload} />
              </EmptyContent>
            )}
          </Empty>
        </div>
      ) : (
        <div className="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-6">
          <div className="flex flex-col gap-4">
            {open.length === 0 ? null : (
              <section className="flex flex-col gap-1.5">
                <h2 className="px-3 text-xs font-medium text-muted-foreground">
                  {t.imports.listTitle}
                </h2>
                <ItemGroup>
                  {open.map((detail) => (
                    <ImportRow key={detail.id} detail={detail} active={detail.id === importId} />
                  ))}
                </ItemGroup>
              </section>
            )}
            <ItemGroup>
              {templates.map((s) => (
                <TemplateRow key={s.id} status={s} active={s.id === current?.id} />
              ))}
            </ItemGroup>
          </div>
          {importId !== undefined ? (
            <ImportChat key={importId} id={importId} onChange={imports.reload} />
          ) : current ? (
            <TemplateDetail status={current} root={ws?.root} />
          ) : (
            <div className="rounded-3xl border border-dashed">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <LayoutTemplateIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t.templates.missingTitle}</EmptyTitle>
                  <EmptyDescription>{t.templates.missingBody}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

/** An import in progress, above the templates it may add. */
function ImportRow({ detail, active }: { detail: ImportSummary; active: boolean }) {
  const t = useMessages();
  const state = importState(detail, NO_RUN);

  return (
    <div className="relative rounded-2xl select-none has-focus-visible:*:bg-muted">
      <Item variant={active ? "muted" : "default"} size="sm">
        <ItemMedia variant="icon">{isWorking(state) ? <Spinner /> : <DownloadIcon />}</ItemMedia>
        <ItemContent>
          <ItemTitle>
            <a
              href={href("templates", importRouteId(detail.id))}
              aria-current={active ? "page" : undefined}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              <ImportName doc={detail.doc} linked={false} />
            </a>
          </ItemTitle>
          <ItemDescription>{t.imports.state[state]}</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}

function TemplateRow({ status, active }: { status: FormatStatus; active: boolean }) {
  const t = useMessages();
  const state = templateState(status);
  const image = coverOf(status);
  const doc = status.format?.doc;

  return (
    <div className="relative rounded-2xl select-none has-focus-visible:*:bg-muted">
      <Item variant={active ? "muted" : "default"} size="sm">
        <ItemMedia variant={image === undefined ? "icon" : "image"}>
          {image === undefined ? (
            <LayoutTemplateIcon />
          ) : (
            <img src={fileUrl(image)} alt="" loading="lazy" />
          )}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            <a
              href={href("templates", status.id)}
              aria-current={active ? "page" : undefined}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {doc?.title ?? status.id}
            </a>
          </ItemTitle>
          <ItemDescription>
            {state === "ready" ? doc?.summary || t.templates.state.ready : t.templates.state[state]}
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
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

function List({
  title,
  items,
  ordered = false,
}: {
  title: string;
  items: string[];
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

function TemplateDetail({ status, root }: { status: FormatStatus; root: string | undefined }) {
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
  const source = doc.source?.url === undefined ? undefined : safeHttpUrl(doc.source.url);
  const missing = missingFiles(status);

  return (
    <>
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

      {doc.skills.length + doc.requires.length + doc.tools.length > 0 ||
      doc.source !== undefined ? (
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2">
          {doc.skills.length === 0 ? null : (
            <Fact label={t.templates.skills}>
              {doc.skills.map((skill) => {
                const installed = status.check.skills[skill.name] !== undefined;

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
          {doc.tools.length === 0 ? null : (
            <Fact label={t.templates.tools}>
              {doc.tools.map((tool) => (
                <code key={tool}>{tool}</code>
              ))}
            </Fact>
          )}
          {doc.source?.url === undefined ? null : (
            <Fact label={t.templates.source}>
              {source === undefined ? (
                <span className="truncate">{doc.source.url}</span>
              ) : (
                <a
                  href={source}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate underline underline-offset-4"
                >
                  {doc.source.url}
                </a>
              )}
            </Fact>
          )}
          {doc.source?.author === undefined ? null : (
            <Fact label={t.templates.author}>{doc.source.author}</Fact>
          )}
          {doc.source?.license === undefined ? null : (
            <Fact label={t.templates.license}>{doc.source.license}</Fact>
          )}
        </dl>
      ) : null}

      {doc.inputs.length === 0 ? null : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-medium">{t.templates.inputs}</h2>
            <p className="text-muted-foreground">{t.templates.inputsBody}</p>
          </div>
          {doc.inputs.map((field) => (
            <InputSummary key={field.id} field={field} dir={format.dir} missing={missing} />
          ))}
        </section>
      )}

      <List title={t.templates.structure} items={doc.structure} ordered />
      <List title={t.templates.hookRules} items={doc.hookRules} />
      <List title={t.templates.checklist} items={doc.checklist} />

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

function InputSummary({
  field,
  dir,
  missing,
}: {
  field: InputField;
  dir: string;
  missing: ReadonlySet<string>;
}) {
  const t = useMessages();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{field.title}</h3>
        {field.required ? <Badge variant="outline">{t.templates.required}</Badge> : null}
        {field.choices.length === 0 ? <Badge variant="ghost">{t.templates.freeText}</Badge> : null}
      </div>
      {field.description === undefined ? null : (
        <p className="text-muted-foreground">{field.description}</p>
      )}
      {field.choices.length === 0 ? (
        field.default === undefined ? null : (
          <p className="text-muted-foreground">{t.templates.defaultValue(field.default)}</p>
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
          {field.choices.map((choice) => (
            <ChoiceCard
              key={choice.id}
              choice={choice}
              dir={dir}
              missing={missing}
              isDefault={choice.id === field.default}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChoiceCard({
  choice,
  dir,
  missing,
  isDefault,
}: {
  choice: InputChoice;
  dir: string;
  missing: ReadonlySet<string>;
  isDefault: boolean;
}) {
  const t = useMessages();

  const preview =
    choice.preview === undefined || missing.has(choice.preview) ? undefined : choice.preview;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border">
      {preview === undefined ? null : isClip(preview) ? (
        // Preview clips are silent loops that show a look, so they have no captions.
        // oxlint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={fileUrl(`${dir}/${preview}`)}
          className="aspect-video w-full bg-muted object-cover"
          muted
          loop
          playsInline
          controls
        />
      ) : (
        <img
          src={fileUrl(`${dir}/${preview}`)}
          alt={choice.title}
          loading="lazy"
          className="aspect-video w-full bg-muted object-cover"
        />
      )}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{choice.title}</span>
          {isDefault ? <Badge variant="secondary">{t.templates.default}</Badge> : null}
        </div>
        {choice.summary === undefined ? null : (
          <p className="text-muted-foreground">{choice.summary}</p>
        )}
      </div>
    </div>
  );
}
