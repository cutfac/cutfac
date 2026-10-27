import { useEffect } from "react";
import { toast } from "sonner";

import { Section } from "@/components/page";
import { SelectionArea } from "@/components/selection-area";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";

import { api, type ErrorReports, type ReportChoices } from "../api.ts";
import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

/** Each view of the settings on screen, so an answer given in one shows in the others too. */
const views = new Set<(data: ErrorReports) => void>();

/** Saves the person's choices and shows them in every view of the settings on screen. */
export async function saveReportChoices(choices: ReportChoices): Promise<void> {
  const saved = await api.setReportChoices(choices);

  for (const show of views) show(saved);
}

/** The error report settings, and a way to change them that says when it couldn't. */
function useErrorReports() {
  const t = useMessages();
  const { data, setData } = useLive("error-reports", api.errorReports);

  useEffect(() => {
    views.add(setData);

    return () => {
      views.delete(setData);
    };
  }, [setData]);

  const save = (choices: ReportChoices) =>
    saveReportChoices(choices).catch((cause: Error) =>
      toast.error(`${t.reports.failed}: ${cause.message}`),
    );

  const resetId = () =>
    api
      .resetInstallId()
      .then((saved) => {
        for (const show of views) show(saved);
      })
      .catch((cause: Error) => toast.error(`${t.reports.failed}: ${cause.message}`));

  return { data, save, resetId };
}

/** One answer for both: error reports and usage statistics go, or neither does. */
export const both = (share: boolean): ReportChoices => ({ errorReports: share, usageStats: share });

/**
 * Asks once, over the board, whether to share error reports and usage statistics: only in a build
 * that can send them, and until the person answers, which the desktop app's first launch already
 * asks. Two buttons of the same weight, and nothing is sent before they say yes.
 */
export function ErrorReportsDialog() {
  const t = useMessages();
  const { data, save } = useErrorReports();

  const unasked =
    data?.available === true && (data.errorReports === null || data.usageStats === null);

  return (
    <Dialog open={unasked}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.reports.askTitle}</DialogTitle>
          <DialogDescription>{t.reports.askBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => save(both(false))}>
            {t.reports.dontShare}
          </Button>
          <Button variant="secondary" onClick={() => save(both(true))}>
            {t.reports.share}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The settings in Settings: send error reports, send usage statistics, and this install's ID with a
 * way to renew it.
 */
export function ErrorReportsCard() {
  const t = useMessages();
  const { data, save, resetId } = useErrorReports();

  if (data?.available !== true) return null;

  return (
    <Section title={t.reports.title} description={t.reports.description}>
      <ItemGroup>
        <Item variant="row">
          <ItemContent>
            <ItemTitle>{t.reports.toggle}</ItemTitle>
            <ItemDescription>{t.reports.toggleHint}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              aria-label={t.reports.toggle}
              checked={data.errorReports === true}
              onCheckedChange={(on) => save({ errorReports: on })}
            />
          </ItemActions>
        </Item>
        <Item variant="row">
          <ItemContent>
            <ItemTitle>{t.reports.usageToggle}</ItemTitle>
            <ItemDescription>{t.reports.usageHint}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              aria-label={t.reports.usageToggle}
              checked={data.usageStats === true}
              onCheckedChange={(on) => save({ usageStats: on })}
            />
          </ItemActions>
        </Item>
        {data.installId === null ? null : (
          <Item variant="row" className="flex-nowrap">
            <ItemContent className="min-w-0">
              <ItemTitle>{t.reports.installId}</ItemTitle>
              <SelectionArea
                render={<p className="font-mono text-xs break-all text-muted-foreground" />}
              >
                {data.installId}
              </SelectionArea>
              <ItemDescription>{t.reports.installIdHint}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button variant="outline" size="sm" onClick={() => resetId()}>
                {t.reports.newId}
              </Button>
            </ItemActions>
          </Item>
        )}
      </ItemGroup>
    </Section>
  );
}
