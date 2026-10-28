import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { type FormEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { api, type ItemSummary } from "../api.ts";
import { useMessages } from "../i18n/index.ts";
import { sendFailed } from "../lib/notify.ts";

/** The one rename dialog, which a video's menu anywhere opens on that video. */
const handle = DialogPrimitive.createHandle<ItemSummary>();

export const openRename = (item: ItemSummary): void => handle.openWithPayload(item);

/** Give a video another title. Mount it once; {@link openRename} opens it. */
export function RenameItemDialog() {
  return (
    <DialogPrimitive.Root handle={handle}>
      {({ payload }) =>
        payload === undefined ? null : <RenameForm key={payload.id} item={payload} />
      }
    </DialogPrimitive.Root>
  );
}

function RenameForm({ item }: { item: ItemSummary }) {
  const t = useMessages();
  const [title, setTitle] = useState(item.title);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const name = title.trim();

  function submit(event: FormEvent) {
    event.preventDefault();

    if (name === item.title) return handle.close();

    setSaving(true);
    api
      .updateItem(item.id, { title: name })
      .then(() => handle.close(), sendFailed)
      .finally(() => setSaving(false));
  }

  return (
    <DialogContent initialFocus={field}>
      <form onSubmit={submit} className="grid gap-6">
        <DialogHeader>
          <DialogTitle>{t.itemActions.renameTitle}</DialogTitle>
        </DialogHeader>
        <Input
          ref={field}
          value={title}
          aria-label={t.item.title}
          onFocus={(event) => event.target.select()}
          onChange={(event) => setTitle(event.target.value)}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>{t.common.cancel}</DialogClose>
          <Button type="submit" disabled={saving || name === ""}>
            {t.itemActions.save}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
