import { useEffect, useState } from "react";

import { LicenseKeyForm } from "@/components/license-key-form";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import type { CutfacDesktop } from "../desktop.ts";

interface DesktopLicenseProps {
  desktop: CutfacDesktop;
}

/** The desktop app's license key dialog, which its menu and the board's plan card open. */
export function DesktopLicense({ desktop }: DesktopLicenseProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(
    () =>
      desktop.onLicenseKeyRequest((hasKey) => {
        setSaved(hasKey);
        setOpen(true);
      }),
    [desktop],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <LicenseKeyForm desktop={desktop} saved={saved} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
