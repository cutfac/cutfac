import { TargetIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BriefForm } from "@/components/onboarding/brief-form";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";

import { briefApi } from "../briefApi.ts";
import type { Live } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";
import {
  briefLine,
  briefPatch,
  EMPTY_BRIEF,
  type BriefDraft,
  type BriefView,
} from "../lib/brief.ts";

/**
 * The workspace's brief under its name: what the videos are for, summed up in a line. It opens a
 * sheet to change it, which the agent reads before every template and video.
 */
export function BriefRow({ brief }: { brief: Live<BriefView> }) {
  const t = useMessages().start.brief;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BriefDraft>(EMPTY_BRIEF);
  const [saving, setSaving] = useState(false);

  const line =
    brief.data === undefined
      ? ""
      : briefLine(brief.data, { purpose: t.purpose, platform: t.platformShort });

  function show(next: boolean) {
    // A save under way closes the sheet itself when it is done.
    if (!next && saving) return;

    // Each opening starts from the file, which the agent may have changed since.
    if (next) setDraft(brief.data ?? EMPTY_BRIEF);

    setOpen(next);
  }

  async function save() {
    setSaving(true);

    try {
      brief.setData(await briefApi.updateBrief(briefPatch(draft)));
      toast.success(t.saved);
      setOpen(false);
    } catch (cause) {
      toast.error(t.saveFailed(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={line === "" ? t.add : `${t.sheetTitle}: ${line}`}
        onClick={() => show(true)}
      >
        <TargetIcon />
        <span className={line === "" ? "text-muted-foreground" : undefined}>
          {line === "" ? t.add : line}
        </span>
      </SidebarMenuButton>
      <Sheet open={open} onOpenChange={show}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{t.sheetTitle}</SheetTitle>
            <SheetDescription>{t.sheetBody}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6">
            <BriefForm value={draft} onChange={setDraft} disabled={saving} />
          </div>
          <SheetFooter>
            {/* Until the brief has loaded, saving would replace it with an empty form. */}
            <Button disabled={saving || brief.data === undefined} onClick={() => void save()}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              {t.save}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </SidebarMenuItem>
  );
}
