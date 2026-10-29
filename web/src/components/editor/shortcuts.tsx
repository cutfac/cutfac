import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import { useMessages } from "../../i18n/index.ts";
import { EDIT_KEYS, SHIFT_KEY } from "../../lib/edit-commands.ts";

interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Every key the editor answers to, opened with `?`. */
export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const t = useMessages();

  const groups: ReadonlyArray<{ title: string; rows: ReadonlyArray<[string, string[]]> }> = [
    {
      title: t.shortcuts.playback,
      rows: [
        [t.shortcuts.playPause, ["Space"]],
        [t.shortcuts.step, ["←", "→"]],
        [t.shortcuts.stepLong, [`${SHIFT_KEY}←`, `${SHIFT_KEY}→`]],
        [t.shortcuts.mute, ["M"]],
        [t.shortcuts.toStart, ["Home"]],
        [t.shortcuts.toEnd, ["End"]],
      ],
    },
    {
      title: t.shortcuts.selection,
      rows: [
        [t.shortcuts.markIn, ["I"]],
        [t.shortcuts.markOut, ["O"]],
        [t.shortcuts.toIn, [`${SHIFT_KEY}I`]],
        [t.shortcuts.toOut, [`${SHIFT_KEY}O`]],
        [t.shortcuts.loop, ["L"]],
        [t.shortcuts.clear, ["Esc"]],
      ],
    },
    {
      title: t.shortcuts.changes,
      rows: [
        [t.shortcuts.undo, [EDIT_KEYS.undo]],
        [t.shortcuts.redo, [EDIT_KEYS.redo]],
      ],
    },
    {
      title: t.shortcuts.request,
      rows: [
        [t.shortcuts.send, ["Enter"]],
        [t.shortcuts.newLine, [`${SHIFT_KEY}Enter`]],
      ],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.shortcuts.title}</DialogTitle>
          <DialogDescription>{t.shortcuts.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
              <dl className="flex flex-col">
                {group.rows.map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between gap-4 py-1">
                    <dt>{label}</dt>
                    <dd>
                      <KbdGroup>
                        {keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="flex items-center justify-between gap-4 border-t pt-3 text-muted-foreground sm:col-span-2">
            {t.shortcuts.help}
            <Kbd>?</Kbd>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
