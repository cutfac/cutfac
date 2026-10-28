import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";

import { StackMark } from "@/components/stack-mark";
import { Button } from "@/components/ui/button";
import { Dropzone, type DroppedFile } from "@/components/ui/dropzone";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

import { api, fileUrl, type ItemDetail, type Media } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { sendFailed } from "../../lib/notify.ts";
import { FileStrip } from "./attachments.tsx";

/** The media to show: the chosen one, else the first video, else whatever there is. */
export function shownMedia(item: ItemDetail, name: string | undefined): Media | undefined {
  return (
    item.media.find((media) => media.name === name) ??
    item.media.find((media) => media.kind === "video") ??
    item.media[0]
  );
}

export const mediaUrl = (item: ItemDetail, media: Media) =>
  fileUrl(`${item.dir}/${media.name}`, media.mtime);

/** Upload a file as new media of the item; the server names it with its aspect. */
function useUpload(
  item: ItemDetail,
  onItem: (item: ItemDetail) => void,
  onUploaded: (name: string) => void,
) {
  const [uploading, setUploading] = useState(false);

  function upload(file: File | undefined) {
    if (file === undefined || uploading) return;

    setUploading(true);

    api
      .uploadMedia(item.id, file)
      .then((next) => {
        onItem(next);

        const added = next.media.find(
          (media) => !item.media.some((old) => old.name === media.name),
        );

        if (added !== undefined) onUploaded(added.name);
      }, sendFailed)
      .finally(() => setUploading(false));
  }

  return {
    uploading,
    /** Takes the first of the files dropped or picked. */
    fromFiles: (files: ReadonlyArray<DroppedFile>) => upload(files[0]?.file),
  };
}

const MEDIA_ACCEPT = "video/*,image/*";

export function NoMedia({
  item,
  onItem,
  onUploaded,
}: {
  item: ItemDetail;
  onItem: (item: ItemDetail) => void;
  onUploaded: (name: string) => void;
}) {
  const { uploading, fromFiles } = useUpload(item, onItem, onUploaded);
  const openFiles = useRef<() => void>(null);
  const t = useMessages();

  return (
    <Dropzone
      label={t.attachments.drop.media}
      accept={MEDIA_ACCEPT}
      multiple={false}
      openRef={openFiles}
      onFiles={fromFiles}
      className="flex flex-1"
    >
      <div className="flex flex-1 rounded-3xl border border-dashed">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <StackMark />
            </EmptyMedia>
            <EmptyTitle>{t.item.noMediaTitle}</EmptyTitle>
            <EmptyDescription>{t.item.noMediaBody}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => openFiles.current?.()}>
              {uploading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {t.item.addMedia}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </Dropzone>
  );
}

/** Every file of the item; pick one to edit, or add another. */
export function MediaStrip({
  item,
  shown,
  onPick,
  onItem,
  onUploaded,
}: {
  item: ItemDetail;
  shown: Media;
  onPick: (name: string) => void;
  onItem: (item: ItemDetail) => void;
  onUploaded: (name: string) => void;
}) {
  const { uploading, fromFiles } = useUpload(item, onItem, onUploaded);
  const t = useMessages();

  return (
    <FileStrip
      title={t.attachments.media}
      label={t.attachments.drop.media}
      addLabel={t.item.addMedia}
      accept={MEDIA_ACCEPT}
      multiple={false}
      uploading={uploading}
      onFiles={fromFiles}
    >
      {item.media.map((media) => (
        <button
          key={media.name}
          type="button"
          aria-pressed={media.name === shown.name}
          title={media.name}
          className="group/media flex w-20 shrink-0 flex-col gap-1 rounded-2xl p-1 text-left outline-none select-none hover:bg-muted focus-visible:bg-muted"
          onClick={() => onPick(media.name)}
        >
          <Thumbnail src={mediaUrl(item, media)} media={media} />
          <span className="truncate text-xs text-muted-foreground group-aria-pressed/media:font-medium group-aria-pressed/media:text-foreground">
            {media.name}
          </span>
        </button>
      ))}
    </FileStrip>
  );
}

function Thumbnail({ src, media }: { src: string; media: Media }) {
  const frame =
    "aspect-square w-full rounded-2xl bg-muted object-cover group-aria-pressed/media:ring-2 group-aria-pressed/media:ring-selection";

  if (media.kind === "image") return <img src={src} alt="" loading="lazy" className={frame} />;

  // `#t` shows a frame a little in, past a black first frame.
  return <video src={`${src}#t=0.5`} muted preload="metadata" className={frame} />;
}
