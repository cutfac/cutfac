import { FolderIcon, GlobeIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { linkLabel } from "../../lib/imports.ts";
import { sendFailed } from "../../lib/notify.ts";

const isLink = (source: string) => /^https?:\/\//i.test(source);

/** A source as its chip names it: a link's host and path, or a folder's last name. */
const sourceLabel = (source: string) =>
  isLink(source)
    ? linkLabel(source)
    : (source.split(/[\\/]/).findLast((part) => part !== "") ?? source);

/**
 * Websites and folders for the agent to read before it makes the template, such as a product page
 * or a brand kit. Each kind has a tile of its own, side by side, so either or both read as fine
 * without saying so. They are learned into the workspace's about file when the step starts, so the
 * link still in the field counts too. A browser can't pick a folder, so it shows the website alone.
 */
export function MaterialPicker({
  sources,
  draft,
  onSources,
  onDraft,
}: {
  sources: ReadonlyArray<string>;
  /** What is typed in the field and not added yet. */
  draft: string;
  onSources: (next: string[]) => void;
  onDraft: (next: string) => void;
}) {
  const t = useMessages().start.whatToMake.material;
  const [picking, setPicking] = useState(false);

  const add = (source: string) => {
    const trimmed = source.trim();

    if (trimmed !== "" && !sources.includes(trimmed)) onSources([...sources, trimmed]);
  };

  const remove = (source: string) => onSources(sources.filter((other) => other !== source));

  const choose = () => {
    if (desktop === undefined) return;

    setPicking(true);
    desktop
      .pickPath()
      .then((path) => {
        if (path !== undefined) add(path);
      }, sendFailed)
      .finally(() => setPicking(false));
  };

  return (
    <div className={cn("grid gap-3", desktop === undefined ? null : "sm:grid-cols-2")}>
      <Tile
        icon={<GlobeIcon className="size-4" />}
        title={t.website.title}
        hint={t.website.hint}
        sources={sources.filter(isLink)}
        onRemove={remove}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add(draft);
            onDraft("");
          }}
        >
          <InputGroup>
            <InputGroupInput
              value={draft}
              placeholder={t.placeholder}
              aria-label={t.website.title}
              onChange={(event) => onDraft(event.target.value)}
            />
            {draft.trim() === "" ? null : (
              <InputGroupAddon align="inline-end">
                <InputGroupButton type="submit" variant="secondary" size="xs">
                  {t.add}
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </form>
      </Tile>
      {desktop === undefined ? null : (
        <Tile
          icon={<FolderIcon className="size-4" />}
          title={t.folder.title}
          hint={t.folder.hint}
          sources={sources.filter((source) => !isLink(source))}
          onRemove={remove}
        >
          <Button type="button" variant="outline" disabled={picking} onClick={choose}>
            <FolderIcon data-icon="inline-start" />
            {t.choose}
          </Button>
        </Tile>
      )}
    </div>
  );
}

/** One kind of material: what it is, a way to add it, and what was added. */
function Tile({
  icon,
  title,
  hint,
  sources,
  onRemove,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  sources: ReadonlyArray<string>;
  onRemove: (source: string) => void;
  children: ReactNode;
}) {
  const t = useMessages().start.whatToMake.material;

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
      <header className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-background">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-xs text-pretty text-muted-foreground">{hint}</p>
        </div>
      </header>
      <div className="mt-auto flex flex-col gap-2 [&>button]:w-full">{children}</div>
      {sources.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <li
              key={source}
              title={source}
              // On the tile's fill, a chip takes the page's own, so it stands out.
              className={cn(
                badgeVariants({ variant: "secondary" }),
                "max-w-full bg-background pr-0.5",
              )}
            >
              <span className="truncate">{sourceLabel(source)}</span>
              <button
                type="button"
                aria-label={t.remove(sourceLabel(source))}
                className="flex size-4 items-center justify-center rounded-full transition-colors outline-none hover:bg-foreground/10 focus-visible:bg-foreground/10"
                onClick={() => onRemove(source)}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
