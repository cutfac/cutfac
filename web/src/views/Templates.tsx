import { Match, Option } from "effect";
import { LayoutTemplateIcon } from "lucide-react";
import { useEffect, useEffectEvent, type ReactNode } from "react";

import { ImportChat } from "@/components/import-chat";
import { ErrorAlert, ListSkeleton, Page } from "@/components/page";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";

import { api } from "../api.ts";
import { href, useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { importIdOf, importState, isWorking } from "../lib/imports.ts";
import { NO_RUN } from "../lib/run.ts";
import { sortTemplates } from "../lib/templates.ts";
import { AddTemplate } from "./AddTemplate.tsx";
import { TemplateDetail } from "./TemplateDetail.tsx";
import { ImportRow, TemplateRow } from "./TemplateRows.tsx";

/** How often the list looks again while an import's agent works; the file watcher skips them. */
const IMPORT_POLL_MS = 2000;

function useOpenImports() {
  const imports = useLive("imports", api.imports);

  // A learn import reads the user's material into about.md and makes no template; the board says it.
  const open =
    imports.data?.filter((detail) => !detail.doc.closed && detail.doc.kind !== "learn") ?? [];

  const working = open.some((detail) => isWorking(importState(detail, NO_RUN)));
  const reload = useEffectEvent(imports.reload);

  // An import's agent can finish while it is not open; keep its row's state current.
  useEffect(() => {
    if (!working) return;

    const timer = setInterval(() => reload(), IMPORT_POLL_MS);

    return () => clearInterval(timer);
  }, [working]);

  return { open, reload: imports.reload };
}

function EmptyTemplates({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutTemplateIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action === undefined ? null : <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

export function Templates({ selected }: { selected: string | undefined }) {
  const t = useMessages();
  const { data: statuses, error } = useLive("formats-status", api.formatStatuses);
  const { data: ws } = useLive("workspace", api.workspace);
  const imports = useOpenImports();
  const templates = statuses === undefined ? undefined : sortTemplates(statuses);
  const importId = importIdOf(selected);

  const current = Option.isSome(importId)
    ? undefined
    : selected === undefined
      ? templates?.[0]
      : templates?.find((s) => s.id === selected);

  const empty = templates?.length === 0 && imports.open.length === 0 && Option.isNone(importId);

  return (
    <Page
      width="wide"
      title={t.templates.title}
      description={t.templates.description}
      actions={
        // With nothing yet, the empty page offers the one way to add.
        ws === undefined || empty ? null : (
          <AddTemplate ws={ws} onStarted={imports.reload} size="sm" />
        )
      }
    >
      {error ? (
        <ErrorAlert title={t.templates.loadError} message={error} />
      ) : templates === undefined ? (
        <ListSkeleton rows={4} />
      ) : empty ? (
        <EmptyTemplates
          title={t.templates.emptyTitle}
          action={ws === undefined ? undefined : <AddTemplate ws={ws} onStarted={imports.reload} />}
        >
          {t.templates.emptyBody((text) => (
            <a href={href("learn")}>{text}</a>
          ))}
        </EmptyTemplates>
      ) : (
        <div className="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-6">
          <div className="flex flex-col gap-4">
            {imports.open.length === 0 ? null : (
              <section className="flex flex-col gap-1.5">
                <h2 className="px-3 text-xs font-medium text-muted-foreground">
                  {t.imports.listTitle}
                </h2>
                <ItemGroup>
                  {imports.open.map((detail) => (
                    <ImportRow
                      key={detail.id}
                      detail={detail}
                      active={Option.contains(importId, detail.id)}
                    />
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
          {Match.value(importId).pipe(
            Match.tag("Some", ({ value }) => (
              <ImportChat key={value} id={value} onChange={imports.reload} />
            )),
            Match.tag("None", () =>
              current ? (
                <TemplateDetail status={current} root={ws?.root} />
              ) : (
                <EmptyTemplates title={t.templates.missingTitle}>
                  {t.templates.missingBody}
                </EmptyTemplates>
              ),
            ),
            Match.exhaustive,
          )}
        </div>
      )}
    </Page>
  );
}
