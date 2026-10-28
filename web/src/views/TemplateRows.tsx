import { Option } from "effect";
import { DownloadIcon, LayoutTemplateIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ImportName } from "@/components/import-source";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";

import { fileUrl, type FormatStatus, type ImportSummary } from "../api.ts";
import { href } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { importRouteId, importState, isWorking } from "../lib/imports.ts";
import { NO_RUN } from "../lib/run.ts";
import { coverOf, templateState } from "../lib/templates.ts";

function ListRow({
  to,
  active,
  media,
  title,
  description,
}: {
  to: string;
  active: boolean;
  media: ReactNode;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <div className="relative rounded-2xl select-none has-focus-visible:*:bg-muted">
      <Item variant={active ? "muted" : "default"} size="sm">
        {media}
        <ItemContent>
          <ItemTitle>
            <a
              href={to}
              aria-current={active ? "page" : undefined}
              className="outline-none after:absolute after:inset-0 after:rounded-2xl"
            >
              {title}
            </a>
          </ItemTitle>
          <ItemDescription>{description}</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}

/** An import in progress, above the templates it may add. */
export function ImportRow({ detail, active }: { detail: ImportSummary; active: boolean }) {
  const t = useMessages();
  const state = importState(detail, NO_RUN);

  return (
    <ListRow
      to={href("templates", importRouteId(detail.id))}
      active={active}
      media={
        <ItemMedia variant="icon">{isWorking(state) ? <Spinner /> : <DownloadIcon />}</ItemMedia>
      }
      title={<ImportName doc={detail.doc} linked={false} />}
      description={t.imports.state[state]}
    />
  );
}

export function TemplateRow({ status, active }: { status: FormatStatus; active: boolean }) {
  const t = useMessages();
  const state = templateState(status);
  const image = coverOf(status);
  const doc = status.format?.doc;

  return (
    <ListRow
      to={href("templates", status.id)}
      active={active}
      media={
        Option.isSome(image) ? (
          <ItemMedia variant="image">
            <img src={fileUrl(image.value)} alt="" loading="lazy" />
          </ItemMedia>
        ) : (
          <ItemMedia variant="icon">
            <LayoutTemplateIcon />
          </ItemMedia>
        )
      }
      title={doc?.title ?? status.id}
      description={
        state === "ready" ? doc?.summary || t.templates.state.ready : t.templates.state[state]
      }
    />
  );
}
