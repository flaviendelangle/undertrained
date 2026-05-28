import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { LOCALES, LOCALE_LABEL, type Locale } from "~/i18n/locales";
import { useLocale, useT } from "~/i18n/useT";

/** Account language picker. Persists to the DB + a cookie via `setLocale`. */
export function LanguageSelect() {
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    <div>
      <div className="text-muted-foreground mb-2 text-xs font-medium">
        {t("settings.language.label")}
      </div>
      <Select
        value={locale}
        onValueChange={(value) => setLocale(value as Locale)}
      >
        <SelectTrigger size="sm" className="w-full md:w-64">
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
    </div>
  );
}
