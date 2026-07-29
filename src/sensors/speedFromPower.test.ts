import { describe, expect, it } from "vitest";

import {
  SpeedSimulator,
  distanceIncrementMeters,
  msToKmh,
} from "./speedFromPower";

/** Rider 75 kg + bike 8 kg, as the app's default settings resolve. */
const TOTAL_MASS_KG = 83;

function settle(
  sim: SpeedSimulator,
  power: number,
  seconds: number,
  totalMassKg = TOTAL_MASS_KG,
): number {
  let speed = 0;
  for (let i = 0; i < seconds; i++) {
    speed = sim.update(power, 1, { totalMassKg });
  }
  return speed;
}

describe("msToKmh", () => {
  it("converts m/s to km/h", () => {
    expect(msToKmh(10)).toBeCloseTo(36, 6);
  });
});

describe("SpeedSimulator", () => {
  it("starts at rest", () => {
    expect(new SpeedSimulator().getSpeed()).toBe(0);
  });

  it("converges to a realistic steady speed for a threshold effort", () => {
    const kmh = msToKmh(settle(new SpeedSimulator(), 250, 300));
    // 250 W on the flat, default CdA 0.35 / Crr 0.004 — around 33-37 km/h.
    expect(kmh).toBeGreaterThan(33);
    expect(kmh).toBeLessThan(37);
  });

  it("goes faster for more power", () => {
    const easy = settle(new SpeedSimulator(), 150, 300);
    const hard = settle(new SpeedSimulator(), 350, 300);
    expect(hard).toBeGreaterThan(easy);
  });

  it("counts the mass it is given and nothing more", () => {
    // Steady state solves P·η/v = ½·ρ·CdA·v² + Crr·m·g. Rolling resistance is
    // the only mass-dependent term, so comparing against the analytic root for
    // the mass we passed pins that the simulator adds no mass of its own — a
    // hardcoded bike mass on top of the caller's would show up here.
    const GRAVITY = 9.80665;
    const analyticSteadySpeed = (power: number, totalMassKg: number) => {
      const drag = 0.5 * 1.225 * 0.35;
      const roll = 0.004 * totalMassKg * GRAVITY;
      let lo = 0;
      let hi = 30;
      for (let i = 0; i < 200; i++) {
        const v = (lo + hi) / 2;
        if (drag * v ** 3 + roll * v < power * 0.97) lo = v;
        else hi = v;
      }
      return (lo + hi) / 2;
    };

    for (const totalMassKg of [65, 83, 110]) {
      const simulated = settle(new SpeedSimulator(), 250, 900, totalMassKg);
      expect(simulated).toBeCloseTo(analyticSteadySpeed(250, totalMassKg), 2);
    }
  });

  it("coasts down toward a stop when power drops to zero", () => {
    const sim = new SpeedSimulator();
    const rolling = settle(sim, 250, 300);

    let previous = rolling;
    for (let i = 0; i < 60; i++) {
      const next = sim.update(0, 1, { totalMassKg: TOTAL_MASS_KG });
      expect(next).toBeLessThanOrEqual(previous);
      previous = next;
    }
    expect(previous).toBeLessThan(rolling);
    expect(previous).toBeGreaterThanOrEqual(0);
  });

  it("never returns a negative speed", () => {
    const sim = new SpeedSimulator();
    for (let i = 0; i < 600; i++) {
      expect(sim.update(0, 1, { totalMassKg: TOTAL_MASS_KG })).toBe(0);
    }
  });

  it("integrates a long throttled tick like the equivalent 1 s ticks", () => {
    // A background tab fires the recording interval about once a minute. One
    // 60 s step must land in the same place as sixty 1 s steps, or distance
    // silently diverges from the foreground case.
    const stepped = settle(new SpeedSimulator(), 250, 60);
    const single = new SpeedSimulator().update(250, 60, {
      totalMassKg: TOTAL_MASS_KG,
    });
    expect(single).toBeCloseTo(stepped, 1);
  });

  it("ignores a non-positive time step", () => {
    const sim = new SpeedSimulator();
    settle(sim, 250, 60);
    const before = sim.getSpeed();
    expect(sim.update(250, 0, { totalMassKg: TOTAL_MASS_KG })).toBe(before);
    expect(sim.update(250, -5, { totalMassKg: TOTAL_MASS_KG })).toBe(before);
  });

  it("returns to rest on reset", () => {
    const sim = new SpeedSimulator();
    settle(sim, 300, 120);
    expect(sim.getSpeed()).toBeGreaterThan(0);
    sim.reset();
    expect(sim.getSpeed()).toBe(0);
  });
});

describe("distanceIncrementMeters", () => {
  it("credits a sample with the ground it actually covered", () => {
    expect(distanceIncrementMeters(10, 1)).toBe(10);
    expect(distanceIncrementMeters(10, 0.5)).toBe(5);
  });

  it("gives a throttled 60 s tick the same distance as sixty 1 s ticks", () => {
    // The bug this replaced credited every tick with one second regardless of
    // how long the browser had actually let the timer sleep, so a backgrounded
    // tab recorded 1/60th of the distance the rider covered.
    const throttled = distanceIncrementMeters(10, 60);
    let stepped = 0;
    for (let i = 0; i < 60; i++) stepped += distanceIncrementMeters(10, 1);
    expect(throttled).toBeCloseTo(stepped, 9);
    expect(throttled).toBe(600);
  });

  it("contributes nothing when the rider is not moving", () => {
    expect(distanceIncrementMeters(null, 1)).toBe(0);
    expect(distanceIncrementMeters(0, 1)).toBe(0);
  });

  it("never moves the rider backwards on a bad time step", () => {
    expect(distanceIncrementMeters(10, 0)).toBe(0);
    expect(distanceIncrementMeters(10, -5)).toBe(0);
    expect(distanceIncrementMeters(10, Number.NaN)).toBe(0);
  });
});
