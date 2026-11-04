import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { LOCALES, LOCALE_LABEL, type Locale } from "~/i18n/locales";
import { useLocale, useT } from "~/i18n/useT";

import { SettingRow } from "./layouts/shared";

/** Account language picker. Persists to the DB + a cookie via `setLocale`. */
export function LanguageSelect() {
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    <SettingRow label={t("settings.language.label")}>
      <Select
        value={locale}
        onValueChange={(value) => setLocale(value as Locale)}
      >
        <SelectTrigger size="sm" className="w-60 shrink-0">
          <SelectValue>{LOCALE_LABEL[locale]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {LOCALES.map((value) => (
            <SelectItem key={value} value={value}>
              {LOCALE_LABEL[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
