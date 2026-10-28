import { LanguagesIcon } from "lucide-react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import {
  isLocale,
  LOCALE_NAMES,
  LOCALES,
  setLocale,
  useLocale,
  useMessages,
} from "../../i18n/index.ts";

export function LanguagePicker() {
  const t = useMessages();
  const locale = useLocale();

  return (
    <div className="flex items-center gap-1.5 text-muted-foreground [-webkit-app-region:no-drag]">
      <LanguagesIcon className="size-3.5" aria-hidden />
      <ToggleGroup
        size="sm"
        aria-label={t.language.label}
        value={[locale]}
        onValueChange={([picked]) => {
          if (picked !== undefined && isLocale(picked)) setLocale(picked);
        }}
      >
        {LOCALES.map((option) => (
          <ToggleGroupItem key={option} value={option} lang={option}>
            {LOCALE_NAMES[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
