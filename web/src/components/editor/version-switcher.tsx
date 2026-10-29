import { Option } from "effect";
import { CheckIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import type { Feedback, ItemDetail, Variant } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { ORIGINAL, savedVersions, versionInUse } from "../../lib/requests.ts";
import { VersionsDialog } from "./compare-dialog.tsx";

/** Put a version in the media, or the original back; resolves once it is there. */
export type ChooseVersion = (choice: Variant | typeof ORIGINAL) => Promise<void>;

/**
 * A request's versions as one row: a click puts that one in the video, and the one showing stays
 * marked. Every switch can be undone, so trying one costs nothing; side by side is a click away.
 */
export function VersionSwitcher({
  item,
  feedback,
  onOpen,
  onChoose,
  children,
}: {
  item: ItemDetail;
  feedback: Feedback;
  onOpen: () => void;
  onChoose: ChooseVersion;
  /** More to do with the request, beside comparing side by side. */
  children?: ReactNode;
}) {
  const t = useMessages();
  const [applying, setApplying] = useState<string | undefined>(undefined);
  const versions = savedVersions(feedback);
  const inUse = applying ?? Option.getOrUndefined(versionInUse(feedback));
  // A request for new media had nothing before it to go back to.
  const original = feedback.context?.before !== undefined;

  const choose = (id: string | undefined) => {
    const choice = id === ORIGINAL ? ORIGINAL : versions.find((v) => v.id === id);

    if (choice === undefined || id === inUse) return;

    setApplying(id);
    void onChoose(choice).finally(() => setApplying(undefined));
  };

  const row = (value: string, label: string) => (
    <ToggleGroupItem key={value} value={value}>
      <span className="grid size-4 shrink-0 place-items-center rounded-full ring-1 ring-foreground/25 transition-colors group-aria-pressed/toggle:bg-brand group-aria-pressed/toggle:ring-brand">
        <CheckIcon className="size-3 text-brand-foreground opacity-0 transition-opacity group-aria-pressed/toggle:opacity-100" />
      </span>
      <span className="min-w-0 flex-1 text-pretty">{label}</span>
      {applying === value ? <Spinner /> : null}
    </ToggleGroupItem>
  );

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ToggleGroup
        orientation="vertical"
        variant="row"
        size="row"
        spacing={0.5}
        aria-label={t.versions.title}
        disabled={applying !== undefined}
        value={inUse === undefined ? [] : [inUse]}
        onValueChange={([id]) => choose(id)}
        className="w-full"
      >
        {original ? row(ORIGINAL, t.versions.original) : null}
        {versions.map((variant) => row(variant.id, variant.label))}
      </ToggleGroup>
      <div className="flex flex-wrap items-center gap-1.5">
        <VersionsDialog item={item} feedback={feedback} onOpen={onOpen} onChoose={onChoose} />
        {children}
      </div>
    </div>
  );
}
