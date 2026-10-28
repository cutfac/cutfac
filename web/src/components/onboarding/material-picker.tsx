import { FolderIcon, GlobeIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { badgeVariants } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { linkLabel } from "../../lib/imports.ts";
import { sendFailed } from "../../lib/notify.ts";

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

/** A website as the field shows it: without the scheme `asWebsite` puts back, or a closing slash. */
export const siteLabel = (link: string) => link.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/**
 * The one website for the agent to read first, such as a product page; more can come later from
 * the Brief page. What is in the field is the website, so Enter just moves on.
 */
export function WebsitePicker({
  value,
  onChange,
  onEnter,
  focusOnOpen = false,
}: {
  value: string;
  onChange: (next: string) => void;
  onEnter: () => void;
  focusOnOpen?: boolean;
}) {
  const t = useMessages().start.whatToMake.material;
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusOnOpen) field.current?.focus();
  }, [focusOnOpen]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onEnter();
      }}
    >
      <InputGroup className="h-11">
        <InputGroupAddon className="ml-2">
          <GlobeIcon />
        </InputGroupAddon>
        <InputGroupInput
          ref={field}
          value={value}
          placeholder={t.placeholder}
          aria-label={t.website.title}
          onChange={(event) => onChange(event.target.value)}
        />
      </InputGroup>
    </form>
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
      {/* Shaped like the website field on the step before, but the whole of it is the button. */}
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="h-11 w-full justify-start"
        disabled={picking}
        onClick={choose}
      >
        <FolderIcon data-icon="inline-start" />
        <span className="flex-1 text-left font-normal text-muted-foreground">{t.choose}</span>
        <span className={buttonVariants({ variant: "secondary", size: "xs" })}>{t.browse}</span>
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
