//! Simulated speed and distance, as the website's trainer page computes them
//! (`src/sensors/speedFromPower.ts`): a trainer measures power, not road speed, so speed
//! comes from the rider's power through the Martin et al. (1998) cycling model,
//!   m_eff · dv/dt = F_drive − F_aero − F_roll
//! with F_drive = min(P · η / max(v, V_MIN), F_MAX), F_aero = ½ · ρ · CdA · v² and
//! F_roll = Crr · m · g, integrated with semi-implicit Euler sub-steps.
use serde::Deserialize;

const GRAVITY: f64 = 9.80665;
/// kg/m³ at sea level, 15 °C.
const AIR_DENSITY: f64 = 1.225;
/// A well-maintained chain.
const DRIVETRAIN_EFFICIENCY: f64 = 0.97;
/// F = P/v has no limit as v → 0: below ~3.6 km/h the force is taken at this speed.
const MIN_SPEED: f64 = 1.0;
/// A strong pedal effort through a typical gear, so a standing start is not a rocket.
const MAX_DRIVE_FORCE: f64 = 500.0;
/// Two 700c wheels: m_eff = m_total + 2·I/r² ≈ m_total + 2.1 kg.
const WHEEL_INERTIA_KG: f64 = 2.1;
/// Sub-steps per simulated second, whatever the step, for numerical stability.
const SUB_STEPS_PER_SECOND: f64 = 10.0;

/// The rider and bike the simulation moves: the server's figures when it sends them, the
/// website's defaults otherwise.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rider {
    pub weight_kg: f64,
    pub bike_weight_kg: f64,
    #[serde(rename = "cdA")]
    pub cda: f64,
    pub crr: f64,
}

impl Default for Rider {
    fn default() -> Self {
        Self {
            weight_kg: 75.0,
            bike_weight_kg: 8.0,
            cda: 0.35,
            crr: 0.004,
        }
    }
}

impl Rider {
    /// Within the website's own input limits; anything else is not used.
    pub fn valid(&self) -> bool {
        let within = |v: f64, max: f64| v.is_finite() && v > 0.0 && v <= max;
        within(self.weight_kg, 500.0)
            && within(self.bike_weight_kg, 50.0)
            && within(self.cda, 2.0)
            && within(self.crr, 1.0)
    }
}

#[derive(Debug, Default)]
pub struct Simulator {
    speed: f64,
}

impl Simulator {
    /// The bike stops: a paused ride starts again from a standstill.
    pub fn stop(&mut self) {
        self.speed = 0.0;
    }

    /// Advance by `seconds` at `watts` and return the speed in m/s. No power is zero power:
    /// the rider coasts and slows down, as on the website.
    pub fn update(&mut self, watts: Option<f64>, seconds: f64, rider: &Rider) -> f64 {
        if !seconds.is_finite() || seconds <= 0.0 {
            return self.speed;
        }
        let power = watts.filter(|w| w.is_finite() && *w > 0.0).unwrap_or(0.0);
        let mass = rider.weight_kg + rider.bike_weight_kg;
        let effective_mass = mass + WHEEL_INERTIA_KG;
        let steps = (seconds * SUB_STEPS_PER_SECOND).ceil().max(1.0);
        let step = seconds / steps;
        for _ in 0..steps as u32 {
            let v = self.speed;
            let drive = (power * DRIVETRAIN_EFFICIENCY / v.max(MIN_SPEED)).min(MAX_DRIVE_FORCE);
            let drag = 0.5 * AIR_DENSITY * rider.cda * v * v;
            let rolling = rider.crr * mass * GRAVITY;
            self.speed = (v + (drive - drag - rolling) / effective_mass * step).max(0.0);
        }
        self.speed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steady_power_settles_where_power_balances_drag_and_rolling() {
        let rider = Rider::default();
        let mut sim = Simulator::default();
        let mut speed = 0.0;
        for _ in 0..300 {
            speed = sim.update(Some(200.0), 1.0, &rider);
        }
        // 200 W · 0.97 = (½ ρ CdA v² + Crr m g) · v at v ≈ 9.15 m/s (32.9 km/h).
        let resistance = 0.5 * AIR_DENSITY * rider.cda * speed * speed
            + rider.crr * (rider.weight_kg + rider.bike_weight_kg) * GRAVITY;
        assert!((resistance * speed - 200.0 * DRIVETRAIN_EFFICIENCY).abs() < 0.5);
        assert!((speed * 3.6 - 32.9).abs() < 0.2, "{} km/h", speed * 3.6);
    }

    #[test]
    fn no_power_coasts_down_to_a_stop_and_never_goes_backwards() {
        let rider = Rider::default();
        let mut sim = Simulator::default();
        for _ in 0..120 {
            sim.update(Some(250.0), 1.0, &rider);
        }
        let cruising = sim.update(None, 1.0, &rider);
        let later = sim.update(None, 5.0, &rider);
        assert!(later < cruising, "Coasting slows down");
        assert!(later > 0.0, "Inertia keeps it rolling for a while");
        assert_eq!(sim.update(None, 600.0, &rider), 0.0);
        assert_eq!(sim.update(Some(-40.0), 1.0, &rider), 0.0);
        assert_eq!(sim.update(Some(f64::NAN), 1.0, &rider), 0.0);
    }

    #[test]
    fn one_long_step_integrates_like_many_short_ones() {
        let rider = Rider::default();
        let (mut short, mut long) = (Simulator::default(), Simulator::default());
        for _ in 0..10 {
            short.update(Some(180.0), 1.0, &rider);
        }
        let long_speed = long.update(Some(180.0), 10.0, &rider);
        assert!((short.speed - long_speed).abs() < 1e-9);
        assert_eq!(long.update(Some(180.0), 0.0, &rider), long_speed);
    }

    #[test]
    fn heavier_and_draggier_riders_go_slower() {
        let base = Rider::default();
        let speed_of = |rider: Rider| {
            let mut sim = Simulator::default();
            (0..300).fold(0.0, |_, _| sim.update(Some(200.0), 1.0, &rider))
        };
        let reference = speed_of(base);
        assert!(speed_of(Rider { cda: 0.45, ..base }) < reference);
        assert!(
            speed_of(Rider {
                weight_kg: 95.0,
                ..base
            }) < reference
        );
        assert!(Rider::default().valid());
        assert!(!Rider { cda: 0.0, ..base }.valid());
        assert!(
            !Rider {
                weight_kg: f64::NAN,
                ..base
            }
            .valid()
        );
    }
}
