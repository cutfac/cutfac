import { CheckIcon } from "lucide-react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { ListSkeleton, Section } from "@/components/page";
import { PlatformIcon } from "@/components/platform-icon";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { briefApi } from "../../briefApi.ts";
import type { Live } from "../../hooks.ts";
import { useMessages } from "../../i18n/index.ts";
import {
  briefPatch,
  EMPTY_BRIEF,
  PLATFORMS,
  PURPOSES,
  type BriefDraft,
  type BriefView,
  type Purpose,
} from "../../lib/brief.ts";
import { LiveState } from "../../lib/live.ts";
import { errorText } from "../../lib/notify.ts";

/** How long typing rests before the words are saved. */
const TYPING_REST_MS = 700;

/** How long "Saved" stays before it fades out. */
const SAVED_SHOWN_MS = 2000;

const VERTICAL = new Set(["tiktok", "shorts", "reels"]);

const sameBrief = (a: BriefDraft, b: BriefDraft) =>
  a.purpose === b.purpose &&
  a.body.trim() === b.body.trim() &&
  a.platforms.join() === b.platforms.join();

type SaveState = "idle" | "saving" | "saved";

/**
 * The brief as settings: what the user does, where the videos go, and anything in their own words.
 * Each change saves itself.
 */
export function BriefSettings({ brief }: { brief: Live<BriefView> }) {
  const t = useMessages();

  if (LiveState.$is("Loading")(brief.state))
    return (
      <Section title={t.learn.sheet.title}>
        <div className="py-3">
          <ListSkeleton rows={2} />
        </div>
      </Section>
    );

  return <BriefRows brief={brief} />;
}

/** The form's draft, saved as it changes: picks at once, words once typing rests. */
function useAutosave(brief: Live<BriefView>) {
  const t = useMessages();
  const saved = brief.data ?? EMPTY_BRIEF;
  const [draft, setDraft] = useState<BriefDraft>(saved);
  const [state, setState] = useState<SaveState>("idle");
  const written = useRef<BriefDraft>(saved);
  const queue = useRef(Promise.resolve());
  const typing = useRef<ReturnType<typeof setTimeout>>(undefined);

  // The agent may write the brief too: take what it wrote unless the user has edits of their own.
  const takeWritten = useEffectEvent((next: BriefDraft) => {
    if (sameBrief(next, written.current)) return;

    if (sameBrief(draft, written.current)) setDraft(next);
    written.current = next;
  });

  useEffect(() => takeWritten(saved), [saved]);

  useEffect(() => {
    if (state !== "saved") return;

    const fade = setTimeout(() => setState("idle"), SAVED_SHOWN_MS);

    return () => clearTimeout(fade);
  }, [state]);

  useEffect(() => () => clearTimeout(typing.current), []);

  function save(next: BriefDraft) {
    clearTimeout(typing.current);

    // A brief that couldn't be read would be replaced with this one.
    if (brief.data === undefined) return;

    queue.current = queue.current.then(async () => {
      if (sameBrief(next, written.current)) return;
      setState("saving");

      try {
        const view = await briefApi.updateBrief(briefPatch(next));
        written.current = view;
        brief.setData(view);
        setState("saved");
      } catch (cause) {
        setState("idle");
        toast.error(t.start.brief.saveFailed(errorText(cause)));
      }
    });
  }

  function pick(next: BriefDraft) {
    setDraft(next);
    save(next);
  }

  function type(body: string) {
    const next = { ...draft, body };
    setDraft(next);
    clearTimeout(typing.current);
    typing.current = setTimeout(() => save(next), TYPING_REST_MS);
  }

  return { draft, state, pick, type, flush: () => save(draft) };
}

function BriefRows({ brief }: { brief: Live<BriefView> }) {
  const t = useMessages();
  const words = t.start.brief;
  const sheet = t.learn.sheet;
  const purposeId = useId();
  const bodyId = useId();
  const { draft, state, pick, type, flush } = useAutosave(brief);
  const own = draft.purpose === "own";
  const vertical = draft.platforms.some((platform) => VERTICAL.has(platform));
  const purposes = PURPOSES.map((value) => ({ value, label: words.purpose[value].title }));

  return (
    <Section title={sheet.title} action={<SaveNote state={state} />}>
      <ItemGroup>
        <Item variant="row">
          <ItemContent>
            <ItemTitle id={purposeId}>{sheet.purpose}</ItemTitle>
            <ItemDescription>
              {draft.purpose === null ? sheet.purposeHint : words.purpose[draft.purpose].hint}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select
              items={purposes}
              value={draft.purpose}
              onValueChange={(purpose: Purpose | null) => {
                if (purpose !== null) pick({ ...draft, purpose });
              }}
            >
              <SelectTrigger size="sm" aria-labelledby={purposeId}>
                <SelectValue placeholder={sheet.choose} />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                {purposes.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ItemActions>
        </Item>
        <Item variant="row">
          <ItemContent>
            <ItemTitle>{sheet.platforms}</ItemTitle>
            <ItemDescription>{vertical ? sheet.aspect : words.platformsHint}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ToggleGroup
              multiple
              variant="choice"
              size="sm"
              aria-label={sheet.platforms}
              value={draft.platforms}
              className="flex-wrap justify-end"
              onValueChange={(picked) =>
                // Kept in one order, whatever order they were picked in.
                pick({ ...draft, platforms: PLATFORMS.filter((p) => picked.includes(p)) })
              }
            >
              {PLATFORMS.map((platform) => (
                <ToggleGroupItem key={platform} value={platform}>
                  <PlatformIcon platform={platform} />
                  {words.platformShort[platform]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </ItemActions>
        </Item>
        <Item variant="row">
          <ItemContent>
            <ItemTitle>
              <label htmlFor={bodyId}>{own ? words.ownBodyLabel : sheet.bodyLabel}</label>
            </ItemTitle>
            <Textarea
              id={bodyId}
              value={draft.body}
              placeholder={
                draft.purpose === null
                  ? sheet.bodyPlaceholder
                  : words.purpose[draft.purpose].example
              }
              className="mt-1 min-h-24"
              onChange={(event) => type(event.target.value)}
              onBlur={flush}
            />
          </ItemContent>
        </Item>
      </ItemGroup>
    </Section>
  );
}

function SaveNote({ state }: { state: SaveState }) {
  const sheet = useMessages().learn.sheet;

  return (
    <output
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity duration-500",
        state === "idle" && "opacity-0",
      )}
    >
      {state === "saving" ? <Spinner className="size-3.5" /> : <CheckIcon className="size-3.5" />}
      {state === "saving" ? sheet.saving : sheet.saved}
    </output>
  );
}
