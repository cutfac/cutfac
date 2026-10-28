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
import { asWebsite } from "../../lib/onboarding.ts";

export const isLink = (source: string) => /^https?:\/\//i.test(source);

/** A source as its chip names it: a link's host and path, or a folder's last name. */
const sourceLabel = (source: string) =>
  isLink(source)
    ? linkLabel(source)
    : (source.split(/[\\/]/).findLast((part) => part !== "") ?? source);

interface Sources {
  /** Everything added so far, websites and folders both; each part shows its own kind. */
  sources: ReadonlyArray<string>;
  onSources: (next: string[]) => void;
}

const added = (sources: ReadonlyArray<string>, source: string) => {
  const trimmed = source.trim();

  return trimmed === "" || sources.includes(trimmed) ? [...sources] : [...sources, trimmed];
};

/**
 * Websites for the agent to read before it makes the template, such as a product page. They are
 * learned into the workspace's about file when the step starts, so the link still in the field
 * counts too.
 */
export function WebsitePicker({
  sources,
  onSources,
  draft,
  onDraft,
}: Sources & {
  /** What is typed in the field and not added yet. */
  draft: string;
  onDraft: (next: string) => void;
}) {
  const t = useMessages().start.whatToMake.material;

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSources(added(sources, asWebsite(draft)));
          onDraft("");
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <GlobeIcon />
          </InputGroupAddon>
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
      <Chips shown={sources.filter(isLink)} sources={sources} onSources={onSources} />
    </div>
  );
}

/** Folders for the agent to read where they are, such as a brand kit. Only the desktop app asks. */
export function FolderPicker({ sources, onSources }: Sources) {
  const t = useMessages().start.whatToMake.material;
  const [picking, setPicking] = useState(false);

  const choose = () => {
    if (desktop === undefined) return;

    setPicking(true);
    desktop
      .pickPath()
      .then((path) => {
        if (path !== undefined) onSources(added(sources, path));
      }, sendFailed)
      .finally(() => setPicking(false));
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <Button type="button" size="lg" variant="outline" disabled={picking} onClick={choose}>
        <FolderIcon data-icon="inline-start" />
        {t.choose}
      </Button>
      <Chips
        shown={sources.filter((source) => !isLink(source))}
        sources={sources}
        onSources={onSources}
      />
    </div>
  );
}

/** What a part added, each with a way to take it back out. */
function Chips({ shown, sources, onSources }: Sources & { shown: ReadonlyArray<string> }) {
  const t = useMessages().start.whatToMake.material;

  if (shown.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {shown.map((source) => (
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
  );
}
