import { useState } from "react";
import { toast } from "sonner";

import { BriefForm } from "@/components/onboarding/brief-form";
import { ListSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

import { briefApi } from "../briefApi.ts";
import type { Live } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import { briefPatch, EMPTY_BRIEF, type BriefDraft, type BriefView } from "../lib/brief.ts";

const sameBrief = (a: BriefDraft, b: BriefDraft) =>
  a.purpose === b.purpose &&
  a.body.trim() === b.body.trim() &&
  a.platforms.join() === b.platforms.join();

/**
 * What the videos are for and where they go, on the Brief page above the material. The agent
 * reads it before every template and video.
 */
export function BriefCard({ brief }: { brief: Live<BriefView> }) {
  const t = useMessages().start.brief;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.body}</CardDescription>
      </CardHeader>
      {brief.data === undefined && brief.error === undefined ? (
        <CardContent>
          <ListSkeleton rows={2} />
        </CardContent>
      ) : (
        // The form starts over from the file whenever the file changes, as the agent may write it.
        <BriefEditor key={JSON.stringify(brief.data ?? null)} brief={brief} />
      )}
    </Card>
  );
}

function BriefEditor({ brief }: { brief: Live<BriefView> }) {
  const t = useMessages().start.brief;
  const saved = brief.data ?? EMPTY_BRIEF;
  const [draft, setDraft] = useState<BriefDraft>(saved);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);

    try {
      brief.setData(await briefApi.updateBrief(briefPatch(draft)));
      toast.success(t.saved);
    } catch (cause) {
      toast.error(t.saveFailed(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <CardContent>
        <BriefForm value={draft} onChange={setDraft} disabled={saving} />
      </CardContent>
      <CardFooter className="justify-end">
        {/* A brief that couldn't be read would be replaced with this form. */}
        <Button
          disabled={saving || brief.data === undefined || sameBrief(draft, saved)}
          onClick={() => void save()}
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          {t.save}
        </Button>
      </CardFooter>
    </>
  );
}
