import { PauseIcon, PlayIcon, RepeatIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";

import { useMessages } from "../../i18n/index.ts";
import { usePlayer, type Player } from "../../lib/player.ts";
import { readStored, writeStored } from "../../lib/storage.ts";
import { hasRange, isEmptyTarget, type Target } from "../../lib/target.ts";
import { formatTime } from "../../lib/time.ts";
import { Hint, keepFocus } from "./hint.tsx";

/** Set once the user has pointed at a part, after which the hint on how to stays away. */
const POINTED_KEY = "cutfac.editor.pointed";

interface TransportProps {
  player: Player;
  target: Target;
  loop: boolean;
  onLoop: (loop: boolean) => void;
}

/**
 * Play, mute, and loop the selection; I and O mark the selection at the playhead from the keyboard.
 * The selection itself shows in the composer, where it goes with the request.
 */
export function Transport({ player, target, loop, onLoop }: TransportProps) {
  const paused = usePlayer(player, (state) => state.paused);
  const muted = usePlayer(player, (state) => state.muted);
  const empty = isEmptyTarget(target);
  const [pointed, setPointed] = useState(() => readStored(POINTED_KEY) !== null);
  const t = useMessages();

  if (!empty && !pointed) setPointed(true);

  useEffect(() => {
    if (pointed) writeStored(POINTED_KEY, "1");
  }, [pointed]);

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
      <Hint label={muted ? t.transport.unmute : t.transport.mute} keys="M">
        <Toggle
          size="sm"
          variant="outline"
          aria-label={t.transport.mute}
          pressed={muted}
          onMouseDown={keepFocus}
          onPressedChange={() => player.toggleMute()}
        >
          {muted ? <VolumeXIcon /> : <Volume2Icon />}
        </Toggle>
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
      {empty && !pointed ? (
        <p className="ml-auto text-xs text-muted-foreground">{t.transport.hint}</p>
      ) : null}
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
