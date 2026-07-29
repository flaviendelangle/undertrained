const GRAVITY = 9.80665;
const DEFAULT_AIR_DENSITY = 1.225; // kg/m³ at sea level 15°C

// Drivetrain efficiency (well-maintained chain)
const DRIVETRAIN_ETA = 0.97;

// Minimum velocity for F = P/v to avoid singularity at v → 0.
// Below this, force is capped as if riding at V_MIN (~3.6 km/h).
const V_MIN = 1.0; // m/s

// Maximum driving force at the rear wheel (N).
// Limits unrealistic acceleration at very low speeds.
// ~500 N corresponds to a strong pedal effort through a typical gear ratio.
const F_DRIVE_MAX = 500;

// Wheel rotational inertia: two 700c wheels ≈ 0.12 kg·m² each, r ≈ 0.34 m
// m_eff = m_total + 2·I/r² ≈ m_total + 2.1 kg
const WHEEL_INERTIA_EQUIV_KG = 2.1;

// Sub-steps per second of simulated time, for numerical stability
const SUB_STEPS_PER_SECOND = 10;

/**
 * Physics-based cycling speed simulator.
 *
 * Based on the Martin et al. (1998) cycling power model:
 *   m_eff · dv/dt = F_drive − F_aero − F_roll
 *
 * Where:
 *   F_drive = min(P · η / max(v, V_MIN), F_MAX)
 *   F_aero  = ½ · ρ · CdA · v²
 *   F_roll  = Crr · m · g
 *   m_eff   = m_total + wheel inertia equivalent
 *
 * `m_total` is supplied whole by the caller as `totalMassKg` — rider, bike and
 * anything else on board. The simulator adds no mass of its own beyond the
 * wheel inertia equivalent.
 *
 * Integration uses semi-implicit Euler with sub-stepping for stability.
 */
export class SpeedSimulator {
  private speed = 0; // m/s

  /**
   * Advance the simulation by `dt` seconds with the given instantaneous power.
   * Returns the new speed in m/s.
   */
  update(
    power: number,
    dt: number,
    params: {
      /** Rider + bike + kit, in kilograms. */
      totalMassKg: number;
      cdA?: number;
      crr?: number;
      airDensity?: number;
    },
  ): number {
    const {
      totalMassKg,
      cdA = 0.35,
      crr = 0.004,
      airDensity = DEFAULT_AIR_DENSITY,
    } = params;

    if (dt <= 0) return this.speed;

    const mEff = totalMassKg + WHEEL_INERTIA_EQUIV_KG;
    // Keep the sub-step size independent of `dt` so a long tick (a throttled
    // background tab) integrates as accurately as a 1 s one.
    const subSteps = Math.max(1, Math.ceil(dt * SUB_STEPS_PER_SECOND));
    const subDt = dt / subSteps;

    for (let i = 0; i < subSteps; i++) {
      const v = this.speed;

      // Driving force: F = P·η / v, clamped at low speed and capped
      const vSafe = Math.max(v, V_MIN);
      const driveForce = Math.min(
        (power * DRIVETRAIN_ETA) / vSafe,
        F_DRIVE_MAX,
      );

      // Aerodynamic drag: F = ½·ρ·CdA·v²
      const dragForce = 0.5 * airDensity * cdA * v * v;

      // Rolling resistance: F = Crr·m·g
      const rollForce = crr * totalMassKg * GRAVITY;

      const netForce = driveForce - dragForce - rollForce;
      this.speed = Math.max(0, v + (netForce / mEff) * subDt);
    }

    return this.speed;
  }

  reset(): void {
    this.speed = 0;
  }

  getSpeed(): number {
    return this.speed;
  }
}

/** Converts m/s to km/h */
export function msToKmh(ms: number): number {
  return ms * 3.6;
}
