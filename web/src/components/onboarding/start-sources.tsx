import { ArrowUpRightIcon, FolderIcon, GlobeIcon, LinkIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { GALLERY, type GalleryId } from "../../lib/gallery.ts";
import { linkLabel } from "../../lib/imports.ts";
import { sendFailed } from "../../lib/notify.ts";
import { choiceCard } from "./brief-form.tsx";

/** A part of the step the user may leave out, with its label marked so. */
function OptionalSet({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  const t = useMessages().start.whatToMake;

  return (
    <FieldSet>
      <div className="flex flex-col gap-1">
        <FieldLegend variant="label" className="mb-0">
          <span className="flex items-baseline gap-2">
            {label}
            <span className="text-xs font-normal text-muted-foreground">{t.optional}</span>
          </span>
        </FieldLegend>
        <FieldDescription>{hint}</FieldDescription>
      </div>
      {children}
    </FieldSet>
  );
}

/** The reference as the step keeps it: one from the gallery, or a link the user pasted. */
export interface ReferenceChoice {
  picked: GalleryId | undefined;
  pasted: string;
}

export const NO_REFERENCE: ReferenceChoice = { picked: undefined, pasted: "" };

/** The link the first template starts from, if the user chose one. */
export function referenceLink({ picked, pasted }: ReferenceChoice): string | undefined {
  if (picked !== undefined) return GALLERY.find((entry) => entry.id === picked)?.link;

  return pasted.trim() === "" ? undefined : pasted.trim();
}

/**
 * The examples to build on, as cards to pick one of, or a link of the user's own. Picking the
 * picked card again leaves it out; a pasted link and a card replace each other.
 */
export function ReferencePicker({
  value,
  onChange,
}: {
  value: ReferenceChoice;
  onChange: (next: ReferenceChoice) => void;
}) {
  const t = useMessages().start;

  return (
    <OptionalSet label={t.whatToMake.reference.label} hint={t.whatToMake.reference.hint}>
      <div className="grid grid-cols-2 gap-2">
        {GALLERY.map((entry) => {
          const copy = t.gallery[entry.id];

          return (
            <div key={entry.id} className="relative">
              <button
                type="button"
                aria-pressed={value.picked === entry.id}
                className={cn(choiceCard, "size-full pr-9")}
                onClick={() =>
                  onChange({
                    picked: value.picked === entry.id ? undefined : entry.id,
                    pasted: "",
                  })
                }
              >
                <span className="text-sm font-medium">{copy.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {copy.description}
                </span>
                <span className="mt-auto pt-1 text-xs text-muted-foreground/80">
                  {entry.license}
                </span>
              </button>
              {/* A sibling, not inside the card: a link can't sit in a button. */}
              <a
                href={entry.link}
                target="_blank"
                rel="noreferrer"
                aria-label={t.whatToMake.reference.open(copy.title)}
                title={linkLabel(entry.link)}
                className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted"
              >
                <ArrowUpRightIcon className="size-3.5" />
              </a>
            </div>
          );
        })}
      </div>
      <InputGroup>
        <InputGroupAddon>
          <LinkIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="url"
          value={value.pasted}
          placeholder={t.whatToMake.reference.paste}
          aria-label={t.whatToMake.reference.paste}
          onChange={(event) =>
            onChange({
              picked: event.target.value.trim() === "" ? value.picked : undefined,
              pasted: event.target.value,
            })
          }
        />
      </InputGroup>
    </OptionalSet>
  );
}

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
    <OptionalSet label={t.label} hint={t.hint}>
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
    </OptionalSet>
  );
}
