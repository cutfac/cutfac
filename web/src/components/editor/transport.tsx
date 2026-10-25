import { PauseIcon, PlayIcon, RepeatIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";

import { useMessages } from "../../i18n/index.ts";
import { usePlayer, type Player } from "../../lib/player.ts";
import { hasRange, isEmptyTarget, type Target } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";
import { Hint, keepFocus } from "./hint.tsx";

interface TransportProps {
  player: Player;
  target: Target;
  loop: boolean;
  onLoop: (loop: boolean) => void;
  onIn: () => void;
  onOut: () => void;
}

/**
 * Play, mark in and out at the playhead, and loop the selection. The selection itself shows in
 * the composer, where it goes with the request.
 */
export function Transport({ player, target, loop, onLoop, onIn, onOut }: TransportProps) {
  const paused = usePlayer(player, (state) => state.paused);
  const empty = isEmptyTarget(target);
  const t = useMessages();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Hint label={paused ? t.transport.play : t.transport.pause} keys="Space">
        <Button
          variant="secondary"
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
      {empty ? <p className="ml-auto text-xs text-muted-foreground">{t.transport.hint}</p> : null}
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
