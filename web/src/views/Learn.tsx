import { FolderOpenIcon } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { BriefSettings } from "@/components/brief/brief-settings";
import { MaterialSection } from "@/components/brief/material";
import { Page, Section } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";

import { api } from "../api.ts";
import { briefApi } from "../briefApi.ts";
import { desktop } from "../desktop.ts";
import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { aboutParts } from "../lib/about.ts";
import { sendFailed } from "../lib/notify.ts";

/**
 * The Brief page, what the agent reads before every video: what the user makes and where it goes,
 * the material the agent read with what it kept from each, and any other notes in about.md.
 */
export function Learn() {
  const t = useMessages();
  const brief = useLive("brief", briefApi.brief);
  const learned = useLive("learned", api.learned);
  const about = learned.data?.about;
  const { learned: kept, notes } = aboutParts(about?.text ?? "");

  const showFile =
    desktop && about ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => desktop?.revealPath(about.path).catch(sendFailed)}
      >
        <FolderOpenIcon data-icon="inline-start" />
        {t.learn.showFile}
      </Button>
    ) : null;

  return (
    <Page width="narrow" title={t.learn.title} description={t.learn.description}>
      <BriefSettings brief={brief} />
      <MaterialSection learned={learned} kept={kept} />
      {notes === "" ? (
        showFile === null ? null : (
          <div className="-mt-3 flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            {t.learn.fileNote}
            {showFile}
          </div>
        )
      ) : (
        <Section
          title={t.learn.notesTitle}
          description={t.learn.notesBody}
          body="card"
          action={showFile}
        >
          <SelectionArea className="typeset typeset-docs">
            <Markdown remarkPlugins={[remarkGfm]} skipHtml>
              {notes}
            </Markdown>
          </SelectionArea>
        </Section>
      )}
    </Page>
  );
}
