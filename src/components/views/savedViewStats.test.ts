import { afterEach, expect, it } from "vitest";

import { setActiveDateLocale } from "~/i18n/activeDateLocale";
import { DEFAULT_LOCALE } from "~/i18n/locales";

import { viewPeriod } from "./savedViewStats";

afterEach(() => setActiveDateLocale(DEFAULT_LOCALE));

it.each([
  ["a single day", "2025-09-04", "2025-09-04", "4 sept. 2025", false],
  [
    "a trip within a month",
    "2025-09-04",
    "2025-09-11",
    "4–11 sept. 2025",
    false,
  ],
  [
    "a trip across months",
    "2025-08-28",
    "2025-09-03",
    "28 août\u2009–\u20093 sept. 2025",
    false,
  ],
  [
    "a view still collecting activities",
    "2021-06-11",
    "2026-11-03",
    "juin 2021",
    true,
  ],
  ["a finished season", "2024-01-06", "2024-06-30", "janv.–juin 2024", false],
  [
    "finished years",
    "2021-06-11",
    "2024-03-02",
    "juin 2021\u2009–\u2009mars 2024",
    false,
  ],
])("labels %s by its local days", (_, first, last, label, since) => {
  setActiveDateLocale("fr-FR");
  expect(viewPeriod(first, last, "2026-11-04")).toEqual({ since, label });
});
