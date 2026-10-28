import { FolderIcon, GlobeIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { linkLabel } from "../../lib/imports.ts";
import { sendFailed } from "../../lib/notify.ts";

export const isLink = (source: string) => /^https?:\/\//i.test(source);

/** A source by a short name: a link's host and path, or a folder's last name. */
const sourceLabel = (source: string) =>
  isLink(source)
    ? linkLabel(source)
    : (source.split(/[\\/]/).findLast((part) => part !== "") ?? source);

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

/**
 * The one folder for the agent to read where it is, such as a brand kit; more can come later from
 * the Brief page. Only the desktop app asks. Shaped like the website field on the part before; the
 * field picks the folder, or another in its place, and the cross takes it back out.
 */
export function FolderPicker({
  folder,
  onFolder,
}: {
  folder: string | undefined;
  onFolder: (next: string | undefined) => void;
}) {
  const t = useMessages().start.whatToMake.material;
  const [picking, setPicking] = useState(false);

  const choose = () => {
    if (desktop === undefined) return;

    setPicking(true);
    desktop
      .pickPath()
      .then((path) => {
        if (path !== undefined) onFolder(path);
      }, sendFailed)
      .finally(() => setPicking(false));
  };

  return (
    <div className="relative">
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="h-11 w-full justify-start"
        disabled={picking}
        title={folder}
        onClick={choose}
      >
        <FolderIcon data-icon="inline-start" />
        {folder === undefined ? (
          <>
            <span className="flex-1 text-left font-normal text-muted-foreground">{t.choose}</span>
            <span className={buttonVariants({ variant: "secondary", size: "xs" })}>{t.browse}</span>
          </>
        ) : (
          <span className="flex-1 truncate pr-8 text-left font-normal">{sourceLabel(folder)}</span>
        )}
      </Button>
      {folder === undefined ? null : (
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={t.remove(sourceLabel(folder))}
          className="absolute top-1/2 right-2 -translate-y-1/2"
          onClick={() => onFolder(undefined)}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}
