//! Presentation for the ride screen: clock and value formatting, and the bounded chart
//! bins the interface draws. Pure functions over plain numbers, so they are testable and
//! independent of the recording engine's types.

/// A bin count that stays cheap to draw: 300 bins cover ten minutes at two seconds each.
pub const CHART_BINS: usize = 300;
/// The live strip shows the last ten minutes.
pub const WINDOW_SECONDS: f64 = 600.0;
/// The power axis never drops below this, so an easy spin is not drawn as all-out.
const MIN_POWER_AXIS: f64 = 200.0;
/// Headroom above the observed peak and around the heart-rate range.
const AXIS_HEADROOM: f64 = 1.08;
const HR_PADDING: f64 = 10.0;

/// One recorded second as the chart sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub elapsed: f64,
    pub power: Option<f64>,
    pub heart_rate: Option<f64>,
}

/// One drawn bin: fractions of their axes, and the power zone for the bar color.
/// `None` means a gap; it is drawn as nothing, never as zero.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Bin {
    pub power: Option<f64>,
    pub zone: i32,
    pub heart_rate: Option<f64>,
}

/// What the chart shows besides the bins: the axis ceiling and heart-rate range, for labels.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Chart {
    pub bins: Vec<Bin>,
    pub power_top: Option<f64>,
    pub hr_range: Option<(f64, f64)>,
}

/// "4:05", or "1:04:05" past an hour, like the website's elapsed clock.
pub fn elapsed(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

/// A live or summary value as the screen prints it: rounded, or a dash when absent.
pub fn value(v: Option<f64>) -> String {
    v.map_or("—".to_owned(), |v| format!("{}", v.round() as i64))
}

/// A summary value with its unit, or a dash.
pub fn value_with_unit(v: Option<f64>, unit: &str) -> String {
    v.map_or("—".to_owned(), |v| format!("{} {unit}", v.round() as i64))
}

/// The longest activity name the upload accepts. The server counts UTF-16 code units, as
/// JavaScript string lengths do, so a non-BMP character such as an emoji counts twice.
pub const MAX_ACTIVITY_NAME: usize = 200;
/// Strava's own pages: the activity once Undertrained confirms it, the athlete's
/// dashboard when the outcome is unknown and the rider must look for themselves.
pub const STRAVA_DASHBOARD: &str = "https://www.strava.com/dashboard";

/// A name is fit for upload when it has something other than whitespace and stays bounded.
pub fn activity_name_valid(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty() && trimmed.encode_utf16().count() <= MAX_ACTIVITY_NAME
}

/// The Strava page of a confirmed activity. Only positive ids are ever linked.
pub fn strava_activity_url(id: i64) -> Option<String> {
    (id > 0).then(|| format!("https://www.strava.com/activities/{id}"))
}

/// The website's seven power zones by percent of the account's FTP.
fn zone_for_watts(watts: f64, ftp: f64) -> i32 {
    let pct = watts / ftp * 100.0;
    match pct {
        p if p < 55.0 => 1,
        p if p < 75.0 => 2,
        p if p < 90.0 => 3,
        p if p < 105.0 => 4,
        p if p < 120.0 => 5,
        p if p < 150.0 => 6,
        _ => 7,
    }
}

/// Bin the points that fall in `[from, to)` into `CHART_BINS` equal slots, averaging the
/// readings each slot holds. A slot with no reading stays a gap. The live strip passes the
/// last ten minutes ending now; the summary passes the whole ride. Bars get a zone only from
/// an FTP the server reported for the account; without one, zone 0 asks for a neutral color
/// rather than guessing.
pub fn chart(points: &[Point], from: f64, to: f64, ftp: Option<f64>) -> Chart {
    let span = (to - from).max(1.0);
    let mut sums = vec![(0.0_f64, 0_u32, 0.0_f64, 0_u32); CHART_BINS];
    for p in points {
        if p.elapsed < from || p.elapsed >= to {
            continue;
        }
        let index = (((p.elapsed - from) / span) * CHART_BINS as f64) as usize;
        let slot = &mut sums[index.min(CHART_BINS - 1)];
        if let Some(w) = p.power {
            slot.0 += w;
            slot.1 += 1;
        }
        if let Some(h) = p.heart_rate {
            slot.2 += h;
            slot.3 += 1;
        }
    }
    let averaged: Vec<(Option<f64>, Option<f64>)> = sums
        .iter()
        .map(|(pw, pn, hw, hn)| {
            (
                (*pn > 0).then(|| pw / f64::from(*pn)),
                (*hn > 0).then(|| hw / f64::from(*hn)),
            )
        })
        .collect();
    let peak = averaged.iter().filter_map(|(p, _)| *p).fold(0.0, f64::max);
    let power_top = (peak > 0.0).then_some(peak.max(MIN_POWER_AXIS) * AXIS_HEADROOM);
    let hr_values: Vec<f64> = averaged.iter().filter_map(|(_, h)| *h).collect();
    let hr_range = (!hr_values.is_empty()).then(|| {
        let low = hr_values.iter().cloned().fold(f64::MAX, f64::min) - HR_PADDING;
        let high = hr_values.iter().cloned().fold(f64::MIN, f64::max) + HR_PADDING;
        (low.max(0.0), high.max(low + 1.0))
    });
    let ftp = ftp.filter(|f| *f > 0.0);
    let bins = averaged
        .iter()
        .map(|(p, h)| Bin {
            power: p.and_then(|w| power_top.map(|top| (w / top).clamp(0.0, 1.0))),
            zone: match (p, ftp) {
                (Some(w), Some(ftp)) => zone_for_watts(*w, ftp),
                _ => 0,
            },
            heart_rate: h.and_then(|hr| {
                hr_range.map(|(low, high)| ((hr - low) / (high - low)).clamp(0.0, 1.0))
            }),
        })
        .collect();
    Chart {
        bins,
        power_top,
        hr_range,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clock_reads_like_the_website() {
        assert_eq!(elapsed(0.0), "0:00");
        assert_eq!(elapsed(65.9), "1:05");
        assert_eq!(elapsed(3600.0), "1:00:00");
        assert_eq!(elapsed(3725.0), "1:02:05");
        assert_eq!(elapsed(-3.0), "0:00");
    }

    #[test]
    fn values_round_and_dash() {
        assert_eq!(value(Some(186.4)), "186");
        assert_eq!(value(None), "—");
        assert_eq!(value_with_unit(Some(72.6), "bpm"), "73 bpm");
        assert_eq!(value_with_unit(None, "W"), "—");
    }

    #[test]
    fn gaps_stay_gaps_and_bins_average() {
        // Two seconds per bin over ten minutes: seconds 0 and 1 land in bin 0.
        let points = [
            Point {
                elapsed: 0.0,
                power: Some(100.0),
                heart_rate: Some(120.0),
            },
            Point {
                elapsed: 1.0,
                power: Some(300.0),
                heart_rate: None,
            },
            Point {
                elapsed: 2.0,
                power: None,
                heart_rate: Some(140.0),
            },
            // Out of the window: ignored.
            Point {
                elapsed: 900.0,
                power: Some(999.0),
                heart_rate: Some(200.0),
            },
        ];
        let chart = chart(&points, 0.0, WINDOW_SECONDS, Some(250.0));
        assert_eq!(chart.bins.len(), CHART_BINS);
        let top = chart.power_top.unwrap();
        assert!(
            (top - 200.0 * AXIS_HEADROOM).abs() < 1e-9,
            "Floor of 200 W with headroom"
        );
        let first = chart.bins[0];
        assert!(
            (first.power.unwrap() - 200.0 / top).abs() < 1e-9,
            "Averaged 100 and 300"
        );
        assert_eq!(first.zone, 3, "200 W at 250 W FTP is tempo");
        assert!(first.heart_rate.is_some());
        let second = chart.bins[1];
        assert_eq!(second.power, None, "No power reading is a gap");
        assert_eq!(second.zone, 0);
        assert!(second.heart_rate.is_some());
        assert!(chart.bins[2].power.is_none() && chart.bins[2].heart_rate.is_none());
        assert_eq!(chart.hr_range, Some((110.0, 150.0)));
        assert!(chart.bins[299].power.is_none(), "The far point stays out");
    }

    #[test]
    fn empty_ride_has_no_axes() {
        let chart = chart(&[], 0.0, WINDOW_SECONDS, None);
        assert_eq!(chart.power_top, None);
        assert_eq!(chart.hr_range, None);
        assert!(
            chart
                .bins
                .iter()
                .all(|b| b.power.is_none() && b.heart_rate.is_none())
        );
    }

    #[test]
    fn without_a_server_ftp_bars_carry_no_zone() {
        let points = [Point {
            elapsed: 10.0,
            power: Some(600.0),
            heart_rate: None,
        }];
        for ftp in [None, Some(0.0), Some(-1.0)] {
            let chart = chart(&points, 0.0, WINDOW_SECONDS, ftp);
            let bin = chart.bins[5];
            assert!(bin.power.is_some(), "The bar is still drawn");
            assert_eq!(bin.zone, 0, "No FTP, no zone: {ftp:?}");
        }
    }

    #[test]
    fn activity_names_are_bounded_and_not_blank() {
        assert!(activity_name_valid("Morning ride"));
        assert!(activity_name_valid(&"é".repeat(MAX_ACTIVITY_NAME)));
        assert!(!activity_name_valid(""));
        assert!(!activity_name_valid("   \t"));
        assert!(!activity_name_valid(&"a".repeat(MAX_ACTIVITY_NAME + 1)));
        // The server measures UTF-16 code units: an emoji outside the BMP counts as two.
        assert!(activity_name_valid(&"🚴".repeat(MAX_ACTIVITY_NAME / 2)));
        assert!(!activity_name_valid(
            &"🚴".repeat(MAX_ACTIVITY_NAME / 2 + 1)
        ));
        assert!(!activity_name_valid(&format!(
            "{}🚴",
            "a".repeat(MAX_ACTIVITY_NAME - 1)
        )));
    }

    #[test]
    fn only_positive_activity_ids_are_linked() {
        assert_eq!(
            strava_activity_url(84).as_deref(),
            Some("https://www.strava.com/activities/84")
        );
        assert_eq!(strava_activity_url(0), None);
        assert_eq!(strava_activity_url(-3), None);
    }

    #[test]
    fn a_sprint_lifts_the_axis_and_reddens_the_bar() {
        let points = [Point {
            elapsed: 10.0,
            power: Some(600.0),
            heart_rate: None,
        }];
        let chart = chart(&points, 0.0, WINDOW_SECONDS, Some(250.0));
        assert!((chart.power_top.unwrap() - 600.0 * AXIS_HEADROOM).abs() < 1e-9);
        let bin = chart.bins[5];
        assert_eq!(bin.zone, 7);
        assert!((bin.power.unwrap() - 1.0 / AXIS_HEADROOM).abs() < 1e-9);
    }
}
