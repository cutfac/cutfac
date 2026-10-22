import { safeHttpUrl } from "@/lib/utils";

import type { ImportDoc } from "../api.ts";
import { useMessages } from "../i18n/index.ts";
import { linkLabel } from "../lib/imports.ts";

/** A template's link, opening in a new tab when it is a web address. */
function SourceLink({ link, className }: { link: string; className?: string | undefined }) {
  const url = safeHttpUrl(link);

  if (url === undefined) return <span className={className}>{linkLabel(link)}</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={className ?? "underline underline-offset-4"}
    >
      {linkLabel(link)}
    </a>
  );
}

/** What an import is named by: its link, or the brief a first template is made from. */
export function ImportName({
  doc,
  className,
  linked = true,
}: {
  doc: Pick<ImportDoc, "kind" | "link">;
  className?: string | undefined;
  /** Off inside something that is a link itself, such as a row of the list. */
  linked?: boolean | undefined;
}) {
  const t = useMessages();

  if (doc.kind === "brief" || doc.link === undefined) {
    return <span className={className}>{t.imports.fromBrief}</span>;
  }

  if (!linked) return <span className={className}>{linkLabel(doc.link)}</span>;

  return <SourceLink link={doc.link} className={className} />;
}

/** The import's first message, as the user would have asked for it. */
export function ImportRequest({ doc }: { doc: Pick<ImportDoc, "kind" | "link"> }) {
  const t = useMessages();
  const link = doc.link === undefined ? undefined : <SourceLink link={doc.link} />;

  if (doc.kind === "brief") return t.imports.briefMessage(link);

  return link === undefined ? null : t.imports.startMessage(link);
}
