import { Option } from "effect";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { sendSlashFeedback } from "@/components/feedback-dialog";
import type { PickedIdea } from "@/components/first-ideas";
import { InTitleBar } from "@/components/title-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";

import { api, type AgentChoice, type EditInput, type Media, type Upload } from "../api.ts";
import { HeldChips, useHeldFiles } from "../components/editor/attachments.tsx";
import { ChatTabs, Welcome } from "../components/editor/chat.tsx";
import { ComposerBox } from "../components/editor/composer-box.tsx";
import { editInput, postRequest, preferredAgent } from "../components/editor/composer.tsx";
import { EditorDock } from "../components/editor/dock.tsx";
import { EmptyStage } from "../components/editor/item-media.tsx";
import { href, useAgentStatuses, useModelPicks } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { feedbackCommand } from "../lib/feedback.ts";
import { pickedSettings } from "../lib/models.ts";
import { draftTitle, heldDraft, takeDrafts } from "../lib/newVideo.ts";
import { sendFailed } from "../lib/notify.ts";
import { NO_TARGET } from "../lib/target.ts";

/**
 * A video not made yet: the editor as it is before its first version, with the footage and files
 * the user adds held here. The first request makes the video, uploads what was held, and opens it,
 * so a video exists, counts, and shows in the sidebar from the moment work on it starts.
 */
export function NewVideo({ defaultAgent }: { defaultAgent: AgentChoice | undefined }) {
  const t = useMessages();
  const statuses = useAgentStatuses();
  const [chosen, setChosen] = useState<AgentChoice | undefined>(undefined);
  const agent = chosen ?? preferredAgent(defaultAgent, statuses);
  const [picks, setPick] = useModelPicks();
  const [body, setBody] = useState(heldDraft);
  const [picked, setPicked] = useState<PickedIdea>();
  const [versions, setVersions] = useState(1);
  const [footage, setFootage] = useState<File>();
  const [sending, setSending] = useState(false);
  const files = useHeldFiles();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const text = body.trim();

  useEffect(() => takeDrafts(setBody), []);

  async function send() {
    if (text === "" || sending) return;

    setSending(true);

    try {
      const feedback = feedbackCommand(text);

      // `/feedback` is for the people who make Cutfac, so it makes no video.
      if (Option.isSome(feedback)) {
        if (await sendSlashFeedback(feedback.value, agent)) setBody("");

        return;
      }

      await start({
        title:
          picked?.prompt === text
            ? picked.title
            : Option.getOrElse(draftTitle(text), () => t.newItem.untitled),
        footage,
        uploads: files.uploads,
        request: (media, attachments) =>
          editInput(
            text,
            agent,
            pickedSettings(statuses, picks, agent),
            media,
            NO_TARGET,
            versions,
            attachments,
          ),
      });
    } catch (cause) {
      sendFailed(cause);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <InTitleBar>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <a href={href("board")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            <ArrowLeftIcon data-icon="inline-start" />
            {t.nav.board}
          </a>
          <h1 className="min-w-0 truncate text-sm font-medium">{t.newItem.untitled}</h1>
        </div>
      </InTitleBar>
      <EditorDock
        stage={
          footage === undefined ? (
            <EmptyStage
              maker={Option.none()}
              uploading={false}
              onFiles={(dropped) => setFootage(dropped[0]?.file)}
            />
          ) : (
            <Footage file={footage} onRemove={() => setFootage(undefined)} />
          )
        }
        strips={{}}
        chat={
          <aside className="flex min-h-0 flex-1 flex-col">
            <Tabs value="chat" className="min-h-0 flex-1">
              <ChatTabs details={false} grip />
              <div className="mx-4 flex min-h-0 flex-1 flex-col">
                <Welcome hasMedia={false} />
              </div>
            </Tabs>
            <ComposerBox
              scope="new"
              ideas
              target={NO_TARGET}
              onClearTarget={() => undefined}
              body={body}
              onBody={setBody}
              onIdea={(idea) => {
                setBody(idea.prompt);
                setPicked(idea);
              }}
              placeholder={t.composer.placeholder.new}
              chips={files.entries.length === 0 ? null : <HeldChips files={files} />}
              onFiles={files.add}
              ready={text !== "" && !sending}
              onSend={() => void send()}
              onStop={Option.none()}
              versions={versions}
              onVersions={setVersions}
              statuses={statuses}
              agent={agent}
              onAgent={setChosen}
              picks={picks}
              onPick={setPick}
              inputRef={inputRef}
            />
          </aside>
        }
      />
    </>
  );
}

interface FirstRequest {
  title: string;
  footage: File | undefined;
  /** The files attached to the request, kept as the video's references. */
  uploads: ReadonlyArray<Upload>;
  /** The first request, about the footage once it is the video's media, with the files' paths. */
  request: (media: Media | undefined, attachments: ReadonlyArray<string>) => EditInput;
}

/**
 * Make the video, put in what was held, send the first request, and open it in place of this page.
 * Once the video is made it opens whatever fails after, with the request to send again there.
 */
async function start({ title, footage, uploads, request }: FirstRequest) {
  const made = await api.createItem({ title });

  try {
    const item = footage === undefined ? made : await api.uploadMedia(made.id, footage);

    const { added } =
      uploads.length === 0 ? { added: [] } : await api.uploadReferences(item.id, uploads);

    await postRequest(item, request(item.media[0], added));
  } catch (cause) {
    sendFailed(cause);
  }

  location.replace(href("item", made.id));
}

/** The footage the video starts from, shown as it is until the video is made. */
function Footage({ file, onRemove }: { file: File; onRemove: () => void }) {
  const t = useMessages();
  const shown = useRef<HTMLImageElement & HTMLVideoElement>(null);
  const image = file.type.startsWith("image/");

  // The file stays on this Mac until the video is made, so it shows from a URL of its own.
  useEffect(() => {
    const url = URL.createObjectURL(file);

    if (shown.current !== null) shown.current.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center">
      {image ? (
        <img ref={shown} alt="" className="max-h-full max-w-full rounded-2xl object-contain" />
      ) : (
        <video
          ref={shown}
          controls
          muted
          className="max-h-full max-w-full rounded-2xl bg-black object-contain"
        />
      )}
      <Button
        variant="secondary"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={t.attachments.detach(file.name)}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </div>
  );
}
