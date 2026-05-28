import { describe, expect, it } from "vitest";

import en from "./messages/en";
import fr from "./messages/fr";
import { translate } from "./t";

describe("translate", () => {
  it("resolves a nested key in the requested locale", () => {
    expect(translate(fr, en, "fr-FR", "nav.journal")).toBe("Journal");
    expect(translate(fr, en, "fr-FR", "common.cancel")).toBe("Annuler");
  });

  it("falls back to the English catalog when a key is missing in the locale", () => {
    // Pass an empty locale catalog so every lookup must use the fallback.
    expect(translate({}, en, "fr-FR", "common.cancel")).toBe("Cancel");
  });

  it("returns the raw key when it exists in neither catalog", () => {
    expect(translate(fr, en, "fr-FR", "does.not.exist")).toBe("does.not.exist");
  });

  it("interpolates {name} placeholders", () => {
    expect(
      translate(en, en, "en-GB", "journal.activity.race", { name: "Paris" }),
    ).toBe("Race: Paris");
  });

  it("leaves an unmatched placeholder untouched", () => {
    expect(translate(en, en, "en-GB", "journal.activity.race")).toBe(
      "Race: {name}",
    );
  });

  it("selects the singular plural form from count", () => {
    expect(
      translate(fr, en, "fr-FR", "sync.progress.activitiesLoaded", {
        count: 1,
      }),
    ).toBe("Activités : 1 chargée");
  });

  it("selects the plural form from count", () => {
    expect(
      translate(fr, en, "fr-FR", "sync.progress.activitiesLoaded", {
        count: 4,
      }),
    ).toBe("Activités : 4 chargées");
  });
});
