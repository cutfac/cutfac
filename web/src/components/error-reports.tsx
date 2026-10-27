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

import { api, type ErrorReports } from "../api.ts";
import { useLive } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

/** Each view of the settings on screen, so an answer given in one shows in the others too. */
const views = new Set<(data: ErrorReports) => void>();

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

  const save = (change: Promise<ErrorReports>) =>
    change
      .then((saved) => {
        for (const show of views) show(saved);
      })
      .catch((cause: Error) => toast.error(`${t.reports.failed}: ${cause.message}`));

  return { data, save };
}

/**
 * Asks once, over the board, whether to send error reports: only in a build that can send them,
 * and until the person answers. Nothing is sent before they say yes.
 */
export function ErrorReportsDialog() {
  const t = useMessages();
  const { data, save } = useErrorReports();

  return (
    <Dialog open={data?.available === true && data.errorReports === null}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t.reports.askTitle}</DialogTitle>
          <DialogDescription>{t.reports.askBody}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => save(api.setErrorReports(false))}>
            {t.reports.dontSend}
          </Button>
          <Button onClick={() => save(api.setErrorReports(true))}>{t.reports.send}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The setting in Settings: send error reports or not, and this install's ID with a way to renew it. */
export function ErrorReportsCard() {
  const t = useMessages();
  const { data, save } = useErrorReports();

  if (data?.available !== true) return null;

  return (
    <Section title={t.reports.title} description={t.reports.description}>
      <ItemGroup>
        <Item variant="row">
          <ItemContent>
            <ItemTitle>{t.reports.toggle}</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Switch
              aria-label={t.reports.toggle}
              checked={data.errorReports === true}
              onCheckedChange={(on) => save(api.setErrorReports(on))}
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
              <Button variant="outline" size="sm" onClick={() => save(api.resetInstallId())}>
                {t.reports.newId}
              </Button>
            </ItemActions>
          </Item>
        )}
      </ItemGroup>
    </Section>
  );
}
