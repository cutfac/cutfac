import { CheckIcon, RectangleVerticalIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { ListSkeleton } from "@/components/page";
import { PlatformIcon } from "@/components/platform-icon";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
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
 * The brief as a sentence with blanks to fill, as a creative brief reads: what the user does and
 * where the videos go, then anything in their own words. Each change saves itself.
 */
export function BriefSheet({ brief }: { brief: Live<BriefView> }) {
  return (
    <Card>
      <CardContent>
        {LiveState.$is("Loading")(brief.state) ? (
          <ListSkeleton rows={2} />
        ) : (
          <BriefEditor brief={brief} />
        )}
      </CardContent>
    </Card>
  );
}

function BriefEditor({ brief }: { brief: Live<BriefView> }) {
  const t = useMessages();
  const words = t.start.brief;
  const sheet = t.learn.sheet;
  const bodyId = useId();
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
        toast.error(words.saveFailed(errorText(cause)));
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

  const own = draft.purpose === "own";
  const vertical = draft.platforms.some((platform) => VERTICAL.has(platform));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-2xl leading-snug font-semibold tracking-tight">
        <p>
          <PurposeBlank value={draft} onPick={pick} />
        </p>
        <p>{sheet.goesTo(<PlatformBlank value={draft} onPick={pick} />)}</p>
      </div>
      <div className="flex flex-col gap-1.5 border-t pt-5">
        <label htmlFor={bodyId} className="text-xs font-medium text-muted-foreground">
          {own ? words.ownBodyLabel : sheet.bodyLabel}
        </label>
        <textarea
          id={bodyId}
          value={draft.body}
          placeholder={
            draft.purpose === null ? sheet.bodyPlaceholder : words.purpose[draft.purpose].example
          }
          // Grows with what is written, so it reads as part of the sheet rather than a box.
          className="field-sizing-content min-h-12 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60"
          onChange={(event) => type(event.target.value)}
          onBlur={() => save(draft)}
        />
      </div>
      <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
        {vertical ? (
          <span className="flex items-center gap-1.5">
            <RectangleVerticalIcon className="size-3.5" />
            {sheet.aspect}
          </span>
        ) : (
          <span />
        )}
        <SaveNote state={state} />
      </div>
    </div>
  );
}

function SaveNote({ state }: { state: SaveState }) {
  const sheet = useMessages().learn.sheet;

  return (
    <output
      className={cn(
        "flex items-center gap-1.5 transition-opacity duration-500",
        state === "idle" && "opacity-0",
      )}
    >
      {state === "saving" ? <Spinner className="size-3.5" /> : <CheckIcon className="size-3.5" />}
      {state === "saving" ? sheet.saving : sheet.saved}
    </output>
  );
}

/**
 * A blank in the sentence: underlined in the brand color once filled, dashed while it waits. No
 * chevron, which would split a word from the particle after it in Korean.
 */
function Blank({ filled, children }: { filled: boolean; children: ReactNode }) {
  return (
    <DropdownMenuTrigger render={<BlankButton filled={filled} />}>
      <span
        className={cn(
          "underline decoration-2 underline-offset-4",
          filled ? "decoration-brand" : "decoration-muted-foreground/50 decoration-dashed",
        )}
      >
        {children}
      </span>
    </DropdownMenuTrigger>
  );
}

/** The blank's own button, set in the sentence's type rather than as a control beside it. */
function BlankButton({
  filled,
  className,
  ...props
}: ComponentProps<"button"> & { filled: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "-mx-1 inline rounded-lg px-1 transition-colors outline-none",
        "hover:bg-foreground/6 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-foreground/6",
        !filled && "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

interface BlankProps {
  value: BriefDraft;
  onPick: (next: BriefDraft) => void;
}

function PurposeBlank({ value, onPick }: BlankProps) {
  const t = useMessages();
  const words = t.start.brief;

  return (
    <DropdownMenu>
      <Blank filled={value.purpose !== null}>
        {value.purpose === null ? t.learn.sheet.purpose : words.purpose[value.purpose].title}
      </Blank>
      <DropdownMenuContent className="w-auto min-w-72">
        <DropdownMenuRadioGroup
          value={value.purpose}
          onValueChange={(purpose: Purpose) => onPick({ ...value, purpose })}
        >
          {PURPOSES.map((purpose) => (
            <DropdownMenuRadioItem
              key={purpose}
              value={purpose}
              closeOnClick
              className="items-start"
            >
              <span className="flex flex-col">
                <span className="font-medium">{words.purpose[purpose].title}</span>
                <span className="text-xs text-muted-foreground">{words.purpose[purpose].hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PlatformBlank({ value, onPick }: BlankProps) {
  const t = useMessages();
  const words = t.start.brief;

  function toggle(platform: (typeof PLATFORMS)[number], on: boolean) {
    const picked = new Set(value.platforms);

    if (on) picked.add(platform);
    else picked.delete(platform);
    // Kept in one order, whatever order they were picked in.
    onPick({ ...value, platforms: PLATFORMS.filter((one) => picked.has(one)) });
  }

  return (
    <DropdownMenu>
      <Blank filled={value.platforms.length > 0}>
        {value.platforms.length === 0
          ? t.learn.sheet.where
          : value.platforms.map((platform, index) => (
              <span key={platform} className="whitespace-nowrap">
                {index > 0 ? ", " : null}
                <PlatformIcon
                  platform={platform}
                  className="mr-1 inline size-[0.8em] align-[-0.05em]"
                />
                {words.platformShort[platform]}
              </span>
            ))}
      </Blank>
      <DropdownMenuContent className="w-auto min-w-56">
        {PLATFORMS.map((platform) => (
          <DropdownMenuCheckboxItem
            key={platform}
            checked={value.platforms.includes(platform)}
            onCheckedChange={(on) => toggle(platform, on)}
          >
            <PlatformIcon platform={platform} />
            {words.platform[platform]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
