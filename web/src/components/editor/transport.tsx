import { PauseIcon, PlayIcon, RepeatIcon, XIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useMessages } from "../../i18n/index.ts";
import { usePlayer, type Player } from "../../lib/player.ts";
import { describeTarget, hasRange, isEmptyTarget, type Target } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";

/** Keep focus where it was, so Space and I/O keep driving the player after a click. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

function Hint({ label, keys, children }: { label: string; keys: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipContent>
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

interface TransportProps {
  player: Player;
  target: Target;
  loop: boolean;
  onLoop: (loop: boolean) => void;
  onIn: () => void;
  onOut: () => void;
  onClear: () => void;
}

/** Play, mark in and out at the playhead, loop the selection, and clear it. */
export function Transport({ player, target, loop, onLoop, onIn, onOut, onClear }: TransportProps) {
  const paused = usePlayer(player, (state) => state.paused);
  const empty = isEmptyTarget(target);
  const t = useMessages();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Hint label={paused ? t.transport.play : t.transport.pause} keys="Space">
        <Button
          size="icon"
          aria-label={paused ? t.transport.play : t.transport.pause}
          onMouseDown={keepFocus}
          onClick={() => player.toggle()}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </Button>
      </Hint>
      <Clock player={player} />
      <div className="mx-1 h-5 w-px bg-border" />
      <Hint label={t.transport.inHint} keys="I">
        <Button variant="outline" size="sm" onMouseDown={keepFocus} onClick={onIn}>
          {t.transport.in}
        </Button>
      </Hint>
      <Hint label={t.transport.outHint} keys="O">
        <Button variant="outline" size="sm" onMouseDown={keepFocus} onClick={onOut}>
          {t.transport.out}
        </Button>
      </Hint>
      <Hint label={t.transport.loopHint} keys="L">
        <Toggle
          size="sm"
          variant="outline"
          aria-label={t.transport.loop}
          pressed={loop}
          disabled={!hasRange(target) || target.end === undefined}
          onMouseDown={keepFocus}
          onPressedChange={onLoop}
        >
          <RepeatIcon />
        </Toggle>
      </Hint>
      {empty ? (
        <p className="ml-auto text-xs text-muted-foreground">{t.transport.hint}</p>
      ) : (
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-selection py-0.5 pr-0.5 pl-2 text-xs font-medium text-selection-foreground tabular-nums">
          {describeTarget(target, t.target.boxAt)}
          <Hint label={t.transport.clear} keys="Esc">
            <button
              type="button"
              aria-label={t.transport.clear}
              className="rounded-md p-1 hover:bg-foreground/10"
              onMouseDown={keepFocus}
              onClick={onClear}
            >
              <XIcon className="size-3" />
            </button>
          </Hint>
        </div>
      )}
    </div>
  );
}

/** Its own component, so only the numbers re-render while the video plays. */
function Clock({ player }: { player: Player }) {
  const time = usePlayer(player, (state) => state.time);
  const duration = usePlayer(player, (state) => state.duration);

  return (
    <span className="text-sm text-muted-foreground tabular-nums">
      <span className="text-foreground">{formatTime(time)}</span> / {formatTime(duration)}
    </span>
  );
}
