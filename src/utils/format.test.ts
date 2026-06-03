import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_LOCALE } from "~/i18n/locales";
import { setActiveDateLocale } from "~/i18n/activeDateLocale";

import { formatOrdinal } from "./format";

// formatOrdinal reads the module-level active locale; reset it after each test
// so leaking the singleton can't make other locale-sensitive tests order-dependent.
afterEach(() => setActiveDateLocale(DEFAULT_LOCALE));

describe("formatOrdinal", () => {
  describe("English", () => {
    it("uses st/nd/rd for the units 1–3", () => {
      setActiveDateLocale("en-GB");
      expect(formatOrdinal(1)).toBe("1st");
      expect(formatOrdinal(2)).toBe("2nd");
      expect(formatOrdinal(3)).toBe("3rd");
      expect(formatOrdinal(4)).toBe("4th");
    });

    it("treats the teens 11–13 as 'th' (not st/nd/rd)", () => {
      setActiveDateLocale("en-GB");
      expect(formatOrdinal(11)).toBe("11th");
      expect(formatOrdinal(12)).toBe("12th");
      expect(formatOrdinal(13)).toBe("13th");
    });

    it("re-applies st/nd/rd for the 21–23 units", () => {
      setActiveDateLocale("en-GB");
      expect(formatOrdinal(21)).toBe("21st");
      expect(formatOrdinal(22)).toBe("22nd");
      expect(formatOrdinal(23)).toBe("23rd");
      expect(formatOrdinal(25)).toBe("25th");
    });
  });

  describe("French", () => {
    it("uses '1er' only for 1, then 'Ne'", () => {
      setActiveDateLocale("fr-FR");
      expect(formatOrdinal(1)).toBe("1er");
      expect(formatOrdinal(2)).toBe("2e");
      expect(formatOrdinal(4)).toBe("4e");
      // No English-style teen handling in French.
      expect(formatOrdinal(11)).toBe("11e");
      expect(formatOrdinal(21)).toBe("21e");
    });
  });
});
