import { useState, type SubmitEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacDesktop } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { CUSTOMER_PORTAL_URL } from "../lib/license.ts";

interface LicenseKeyFormProps {
  desktop: CutfacDesktop;
  /** A key is saved already, so a new one replaces it. */
  saved: boolean;
  onSaved: () => void;
}

/**
 * Takes the license key that opens the app and comes with update checks, inside a dialog. Electron
 * has no text field dialog of its own. Cancel closes the dialog, or goes back to the lock screen.
 */
export function LicenseKeyForm({ desktop, saved, onSaved }: LicenseKeyFormProps) {
  const t = useMessages();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const ready = key.trim() !== "" && !busy;

  function submit(event: SubmitEvent) {
    event.preventDefault();

    if (!ready) return;

    setBusy(true);
    setInvalid(false);
    desktop
      .setLicenseKey(key)
      .then((check) => {
        if (check === "invalid") {
          setInvalid(true);

          return;
        }

        onSaved();

        if (check === "granted") toast.success(t.license.granted);
        else toast.warning(check === "ended" ? t.license.ended : t.license.unavailable);
      })
      .catch((cause: Error) => toast.error(cause.message))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t.license.title}</DialogTitle>
        <DialogDescription>
          {t.license.description((text) => (
            <a href={CUSTOMER_PORTAL_URL} target="_blank" rel="noopener noreferrer">
              {text}
            </a>
          ))}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="grid gap-6">
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor="license-key">{t.license.label}</FieldLabel>
          <Input
            id="license-key"
            required
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setInvalid(false);
            }}
            placeholder={t.license.placeholder}
          />
          {invalid ? (
            <FieldError>{t.license.invalid}</FieldError>
          ) : saved ? (
            <FieldDescription>{t.license.replace}</FieldDescription>
          ) : null}
        </Field>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            {t.common.cancel}
          </DialogClose>
          <Button type="submit" disabled={!ready}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? t.license.checking : t.license.save}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
