import { FolderIcon, GlobeIcon, XIcon } from "lucide-react";
import { useState } from "react";

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
 * or a brand kit. They are learned into the workspace's about file when the step starts, so the
 * text still in the field counts too.
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
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add(draft);
          onDraft("");
        }}
      >
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <GlobeIcon />
          </InputGroupAddon>
          <InputGroupInput
            value={draft}
            placeholder={t.placeholder}
            aria-label={t.label}
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
        {desktop === undefined ? null : (
          <Button type="button" variant="outline" disabled={picking} onClick={choose}>
            <FolderIcon data-icon="inline-start" />
            {t.choose}
          </Button>
        )}
      </form>
      {sources.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <li
              key={source}
              title={source}
              className={cn(badgeVariants({ variant: "secondary" }), "max-w-full pr-0.5")}
            >
              {isLink(source) ? (
                <GlobeIcon data-icon="inline-start" />
              ) : (
                <FolderIcon data-icon="inline-start" />
              )}
              <span className="truncate">{sourceLabel(source)}</span>
              <button
                type="button"
                aria-label={t.remove(sourceLabel(source))}
                className="flex size-4 items-center justify-center rounded-full transition-colors outline-none hover:bg-foreground/10 focus-visible:bg-foreground/10"
                onClick={() => onSources(sources.filter((other) => other !== source))}
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
