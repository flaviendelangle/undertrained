//! Exact workout playback, independent of the recorder clock and transport.
use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub duration_seconds: u32,
    pub start_watts: Option<f64>,
    pub end_watts: Option<f64>,
    pub cadence: Option<u16>,
    pub note: Option<String>,
    pub intensity: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub reference_ftp: f64,
    pub ftp_test: Option<String>,
    pub segments: Vec<Segment>,
}
impl Plan {
    pub fn valid(&self) -> bool {
        self.reference_ftp.is_finite()
            && (1.0..=2000.0).contains(&self.reference_ftp)
            && !self.segments.is_empty()
            && self.segments.len() <= 2000
            && self
                .ftp_test
                .as_deref()
                .is_none_or(|s| matches!(s, "ramp-test" | "ftp-test-20"))
            && self.segments.iter().all(|s| {
                s.duration_seconds > 0
                    && s.start_watts.is_some() == s.end_watts.is_some()
                    && [s.start_watts, s.end_watts]
                        .into_iter()
                        .flatten()
                        .all(|w| w.is_finite() && (0.0..=6000.0).contains(&w))
                    && s.cadence.is_none_or(|v| (1..=300).contains(&v))
                    && s.note.as_ref().is_none_or(|v| v.len() <= 4096)
            })
            && self
                .segments
                .iter()
                .try_fold(0u32, |a, s| a.checked_add(s.duration_seconds))
                .is_some_and(|n| n <= 8 * 3600)
    }
}

pub struct Player {
    plan: Plan,
    offset: f64,
    bias: f64,
}
#[derive(Debug, PartialEq)]
pub struct Snapshot {
    pub index: Option<usize>,
    pub next_index: Option<usize>,
    pub remaining: f64,
    pub target_watts: Option<u16>,
    pub cadence: Option<u16>,
    pub progress: f64,
    pub complete: bool,
}
impl Player {
    pub fn new(plan: Plan) -> Self {
        Self {
            plan,
            offset: 0.0,
            bias: 1.0,
        }
    }
    pub fn plan(&self) -> &Plan {
        &self.plan
    }
    pub fn bias(&self) -> f64 {
        self.bias
    }
    pub fn adjust_bias(&mut self, delta: f64) {
        if delta.is_finite() {
            self.bias = ((self.bias + delta).clamp(0.5, 1.5) * 100.0).round() / 100.0;
        }
    }
    pub fn snapshot(&self, elapsed: f64) -> Snapshot {
        let clock = if elapsed.is_finite() {
            elapsed.max(0.0)
        } else {
            0.0
        } + self.offset;
        let total: f64 = self
            .plan
            .segments
            .iter()
            .map(|s| f64::from(s.duration_seconds))
            .sum();
        let mut start = 0.0;
        for (i, s) in self.plan.segments.iter().enumerate() {
            let end = start + f64::from(s.duration_seconds);
            if clock < end {
                let target = s.start_watts.zip(s.end_watts).map(|(a, b)| {
                    let raw = a + (b - a) * ((clock - start) / f64::from(s.duration_seconds));
                    ((raw * self.bias / 5.0).round() * 5.0).clamp(0.0, 1000.0) as u16
                });
                return Snapshot {
                    index: Some(i),
                    next_index: (i + 1 < self.plan.segments.len()).then_some(i + 1),
                    remaining: end - clock,
                    target_watts: target,
                    cadence: s.cadence,
                    progress: if total > 0.0 { clock / total } else { 1.0 },
                    complete: false,
                };
            }
            start = end;
        }
        Snapshot {
            index: None,
            next_index: None,
            remaining: 0.0,
            target_watts: None,
            cadence: None,
            progress: 1.0,
            complete: true,
        }
    }
    pub fn skip(&mut self, elapsed: f64) {
        let s = self.snapshot(elapsed);
        if !s.complete {
            self.offset += s.remaining;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> Plan {
        Plan {
            reference_ftp: 250.0,
            ftp_test: None,
            segments: vec![
                Segment {
                    duration_seconds: 60,
                    start_watts: Some(100.0),
                    end_watts: Some(200.0),
                    cadence: Some(90),
                    note: None,
                    intensity: None,
                },
                Segment {
                    duration_seconds: 30,
                    start_watts: None,
                    end_watts: None,
                    cadence: None,
                    note: None,
                    intensity: None,
                },
                Segment {
                    duration_seconds: 10,
                    start_watts: Some(0.0),
                    end_watts: Some(0.0),
                    cadence: None,
                    note: None,
                    intensity: None,
                },
            ],
        }
    }
    #[test]
    fn matches_website_golden_targets_for_both_builtin_tests() {
        // Generated from web desktopBuiltInWorkouts + resolveSnapshot at commit d10fbbc.
        // Exercises the real wire shape and fixed/relative ramps across four bias values.
        #[derive(Deserialize)]
        struct Fixture {
            id: String,
            plan: Plan,
            cases: Vec<Case>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Case {
            bias: f64,
            elapsed: f64,
            index: Option<usize>,
            remaining: f64,
            target_watts: Option<u16>,
            complete: bool,
        }
        let fixtures: Vec<Fixture> =
            serde_json::from_str(include_str!("../tests/fixtures/workout-player.json")).unwrap();
        for f in fixtures {
            assert!(f.plan.valid());
            for c in f.cases {
                let mut player = Player::new(f.plan.clone());
                player.adjust_bias(c.bias - 1.0);
                let s = player.snapshot(c.elapsed);
                assert_eq!(s.index, c.index, "{} at {}", f.id, c.elapsed);
                assert_eq!(
                    s.target_watts, c.target_watts,
                    "{} at {} with bias {}",
                    f.id, c.elapsed, c.bias
                );
                assert!((s.remaining - c.remaining).abs() < 0.000001);
                assert_eq!(s.complete, c.complete);
            }
        }
    }

    #[test]
    fn ramps_boundaries_and_completion() {
        let p = Player::new(plan());
        assert_eq!(p.snapshot(0.0).target_watts, Some(100));
        assert_eq!(p.snapshot(30.0).target_watts, Some(150));
        assert_eq!(p.snapshot(59.9).index, Some(0));
        assert_eq!(p.snapshot(60.0).index, Some(1));
        assert_eq!(p.snapshot(60.0).target_watts, None);
        assert_eq!(p.snapshot(90.0).target_watts, Some(0));
        assert!(p.snapshot(100.0).complete);
        assert!(p.snapshot(1000.0).complete);
    }
    #[test]
    fn skip_changes_only_player_clock_and_pause_is_stable() {
        let mut p = Player::new(plan());
        let elapsed = 12.0;
        p.skip(elapsed);
        assert_eq!(p.snapshot(elapsed).index, Some(1));
        assert_eq!(p.snapshot(elapsed).remaining, 30.0);
        assert_eq!(p.snapshot(elapsed), p.snapshot(elapsed));
        p.skip(elapsed);
        p.skip(elapsed);
        p.skip(elapsed);
        assert!(p.snapshot(elapsed).complete);
        assert_eq!(elapsed, 12.0);
    }
    #[test]
    fn bias_quantization_and_limits_match_web() {
        let mut p = Player::new(plan());
        p.adjust_bias(0.05);
        assert_eq!(p.snapshot(0.0).target_watts, Some(105));
        p.adjust_bias(10.0);
        assert_eq!(p.bias(), 1.5);
        p.adjust_bias(-10.0);
        assert_eq!(p.bias(), 0.5);
        p.adjust_bias(f64::NAN);
        assert_eq!(p.bias(), 0.5);
        p.plan.segments[0].start_watts = Some(2000.0);
        p.plan.segments[0].end_watts = Some(2000.0);
        p.adjust_bias(1.0);
        assert_eq!(p.snapshot(0.0).target_watts, Some(1000));
    }
    #[test]
    fn reject_unsafe_or_ambiguous_plans() {
        let mut p = plan();
        assert!(p.valid());
        p.segments[0].end_watts = None;
        assert!(!p.valid());
        p = plan();
        p.segments[0].duration_seconds = 0;
        assert!(!p.valid());
        p = plan();
        p.segments[0].duration_seconds = u32::MAX;
        assert!(!p.valid());
        p = plan();
        p.segments[0].start_watts = Some(f64::NAN);
        assert!(!p.valid());
        p = plan();
        p.ftp_test = Some("future-test".into());
        assert!(!p.valid());
    }
}
