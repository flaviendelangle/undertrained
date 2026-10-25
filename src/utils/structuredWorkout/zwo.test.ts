// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { makeRepeat, makeStep, makeWorkout } from "./fixtures";
import { generateZwo } from "./zwo";

function parse(content: string) {
  const document = new DOMParser().parseFromString(content, "application/xml");
  expect(document.querySelector("parsererror")).toBeNull();
  return document;
}

describe("Zwift workout export", () => {
  it("writes ordered cycling blocks, nested repeats, cadence, notes and escaped metadata", () => {
    const name = 'Seuil & côtes <"été"> 🚴';
    const note = 'Stay <steady> & "smooth"\n90 rpm';
    const structure = makeWorkout([
      { ...makeStep("warm", 120, { kind: "ramp", from: 0.5, to: 0.75 }), note },
      makeRepeat("outer", 2, [
        makeRepeat("inner", 2, [
          makeStep("on", 60, 0.95, { cadence: 95 }),
          makeStep("off", 30, { kind: "free" }),
        ]),
      ]),
      makeStep("fixed", 60, { kind: "watts", from: 225, to: 225 }),
      makeStep("cool", 120, { kind: "watts", from: 200, to: 100 }),
    ]);
    const document = parse(
      generateZwo({
        name,
        description: "A & B\n<workout>",
        structure,
        ftp: 250,
      }),
    );
    expect(document.documentElement.tagName).toBe("workout_file");
    expect(document.querySelector("name")?.textContent).toBe(name);
    expect(document.querySelector("description")?.textContent).toBe(
      "A & B\n<workout>",
    );
    expect(document.querySelector("sportType")?.textContent).toBe("bike");
    expect(document.querySelector("textevent")?.getAttribute("message")).toBe(
      note,
    );

    const blocks = Array.from(document.querySelector("workout")!.children).map(
      (block) => ({
        tag: block.tagName,
        attributes: Object.fromEntries(
          Array.from(block.attributes, (attribute) => [
            attribute.name,
            attribute.value,
          ]),
        ),
      }),
    );
    const on = {
      tag: "SteadyState",
      attributes: { Duration: "60", Power: "0.95", Cadence: "95" },
    };
    const off = { tag: "FreeRide", attributes: { Duration: "30" } };
    expect(blocks).toEqual([
      {
        tag: "Warmup",
        attributes: { Duration: "120", PowerLow: "0.5", PowerHigh: "0.75" },
      },
      on,
      off,
      on,
      off,
      on,
      off,
      on,
      off,
      { tag: "SteadyState", attributes: { Duration: "60", Power: "0.9" } },
      {
        tag: "Cooldown",
        attributes: { Duration: "120", PowerLow: "0.8", PowerHigh: "0.4" },
      },
    ]);
  });

  it("exports percentages without an FTP and removes characters forbidden by XML 1.0", () => {
    const document = parse(
      generateZwo({
        name: `Tempo${String.fromCharCode(0, 0xd800)} 🚴`,
        structure: makeWorkout([makeStep("tempo", 600, 0.85)]),
        ftp: null,
      }),
    );
    expect(document.querySelector("name")?.textContent).toBe("Tempo 🚴");
    expect(document.querySelector("SteadyState")?.getAttribute("Power")).toBe(
      "0.85",
    );
  });

  it.each([null, 0, -1, NaN, Infinity])(
    "refuses to invent an FTP for fixed watt targets (%s)",
    (ftp) => {
      expect(() =>
        generateZwo({
          name: "Fixed watts",
          structure: makeWorkout([
            makeStep("fixed", 60, { kind: "watts", from: 200, to: 200 }),
          ]),
          ftp,
        }),
      ).toThrow("exportFtpRequired");
    },
  );

  it("enforces Zwift's 250-block limit after expanding repeats", () => {
    const repeated = makeRepeat(
      "repeat",
      50,
      Array.from({ length: 5 }, (_, i) => makeStep(`step-${i}`, 5, 0.5)),
    );
    const structure = makeWorkout([repeated]);
    const document = parse(generateZwo({ name: "250", structure, ftp: null }));
    expect(document.querySelector("workout")!.children).toHaveLength(250);
    expect(() =>
      generateZwo({
        name: "251",
        structure: makeWorkout([repeated, makeStep("extra", 5, 0.5)]),
        ftp: null,
      }),
    ).toThrow("exportBlockLimit");
  });

  it.each([
    ["exportInvalid", { ...makeWorkout([]) }],
    [
      "exportBikeOnly",
      { ...makeWorkout([makeStep("run", 60, 0.5)]), sport: "run" as const },
    ],
    [
      "exportTestUnsupported",
      {
        ...makeWorkout([makeStep("test", 60, 0.5)]),
        ftpTest: "ramp-test" as const,
      },
    ],
  ])("refuses an unsupported workout (%s)", (issue, structure) => {
    expect(() =>
      generateZwo({ name: "Unsupported", structure, ftp: 250 }),
    ).toThrow(issue);
  });
});
