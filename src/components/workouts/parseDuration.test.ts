import { describe, expect, it } from "vitest";

import { formatDurationInput, parseDuration } from "./parseDuration";

describe("parseDuration", () => {
  it("reads a bare number as minutes", () => {
    expect(parseDuration("5")).toBe(300);
    expect(parseDuration("20")).toBe(1200);
    expect(parseDuration("1.5")).toBe(90);
  });

  it("reads mm:ss", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("12:00")).toBe(720);
    expect(parseDuration("0:45")).toBe(45);
  });

  it("reads h:mm:ss", () => {
    expect(parseDuration("1:05:30")).toBe(3930);
  });

  it("reads explicit units", () => {
    expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("5m")).toBe(300);
    expect(parseDuration("1h")).toBe(3600);
    expect(parseDuration("1m30s")).toBe(90);
    expect(parseDuration("1h05m")).toBe(3900);
  });

  it("reads a trailing bare number after an hour as minutes", () => {
    expect(parseDuration("1h30")).toBe(5400);
  });

  it("tolerates whitespace and case", () => {
    expect(parseDuration("  1M 30S ")).toBe(90);
  });

  it("returns null for anything unparseable", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("   ")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("1:2:3:4")).toBeNull();
    expect(parseDuration("-5")).toBeNull();
  });
});

describe("formatDurationInput", () => {
  it("round-trips through parseDuration", () => {
    for (const seconds of [45, 90, 300, 720, 3930]) {
      expect(parseDuration(formatDurationInput(seconds))).toBe(seconds);
    }
  });

  it("pads and drops the hour when unused", () => {
    expect(formatDurationInput(90)).toBe("1:30");
    expect(formatDurationInput(3600)).toBe("1:00:00");
    expect(formatDurationInput(-5)).toBe("0:00");
  });
});
