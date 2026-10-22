//! Minimal FIT activity encoder, following Garmin's public FIT protocol/profile.
//! Power, heart rate and cadence are exported as measured. Speed and distance are simulated
//! from power, as the website's own FIT export does for an indoor ride; there is no GPS.
//! Strava counts the whole recording of an indoor ride as moving time and ignores timer
//! events, so the file leaves the pauses out of its timeline: every moment after a pause
//! moves earlier by the time the clock stood still, and the activity lasts its active time.
//! The ride's journal keeps the real times.
//! https://developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html
use crate::recording::{Sample, Summary, TimerEvent};

const FIT_EPOCH_MS: u64 = 631_065_600_000;
fn timestamp(ms: u64) -> u32 {
    (ms.saturating_sub(FIT_EPOCH_MS) / 1000).min(u32::MAX as u64 - 1) as u32
}
struct Field {
    number: u8,
    kind: u8,
    bytes: Vec<u8>,
}
fn byte(number: u8, value: u8) -> Field {
    Field {
        number,
        kind: 0x02,
        bytes: vec![value],
    }
}
fn enumeration(number: u8, value: u8) -> Field {
    Field {
        number,
        kind: 0,
        bytes: vec![value],
    }
}
fn short(number: u8, value: u16) -> Field {
    Field {
        number,
        kind: 0x84,
        bytes: value.to_le_bytes().to_vec(),
    }
}
fn long(number: u8, value: u32) -> Field {
    Field {
        number,
        kind: 0x86,
        bytes: value.to_le_bytes().to_vec(),
    }
}
fn message(data: &mut Vec<u8>, global: u16, fields: &[Field]) {
    // Reuse local message zero; a definition directly precedes each data message.
    data.extend([0x40, 0, 0]);
    data.extend(global.to_le_bytes());
    data.push(fields.len() as u8);
    for f in fields {
        data.extend([f.number, f.bytes.len() as u8, f.kind]);
    }
    data.push(0);
    for f in fields {
        data.extend(&f.bytes);
    }
}
fn optional_byte(fields: &mut Vec<Field>, number: u8, value: Option<f64>) {
    if let Some(v) = value.filter(|v| v.is_finite() && *v >= 0.0 && *v < 254.5) {
        fields.push(byte(number, v.round() as u8));
    }
}
fn optional_short(fields: &mut Vec<Field>, number: u8, value: Option<f64>) {
    if let Some(v) = value.filter(|v| v.is_finite() && *v >= 0.0 && *v < 65534.5) {
        fields.push(short(number, v.round() as u16));
    }
}
fn optional_long(fields: &mut Vec<Field>, number: u8, value: Option<f64>) {
    if let Some(v) = value.filter(|v| v.is_finite() && *v >= 0.0 && *v < (u32::MAX - 1) as f64) {
        fields.push(long(number, v.round() as u32));
    }
}
/// FIT distances are in centimetres (scale 100).
fn centimetres(metres: f64) -> Option<f64> {
    Some(metres * 100.0)
}
fn milliseconds(seconds: f64) -> u32 {
    (seconds * 1000.0).round().clamp(0.0, (u32::MAX - 1) as f64) as u32
}
/// The bike at rest where the clock stopped: speed zero, distance unchanged, no measurement.
fn standstill(data: &mut Vec<u8>, timestamp_ms: u64, distance: f64) {
    let mut fields = vec![long(253, timestamp(timestamp_ms))];
    optional_long(&mut fields, 5, centimetres(distance));
    fields.push(short(6, 0));
    message(data, 20, &fields);
}
fn timer(data: &mut Vec<u8>, timestamp_ms: u64, running: bool) {
    message(
        data,
        21,
        &[
            long(253, timestamp(timestamp_ms)),
            enumeration(0, 0),
            enumeration(1, if running { 0 } else { 4 }),
        ],
    );
}
/// The stretches the clock stood still: from each stop to the next start, and from the last
/// stop to the end of the ride.
fn pauses(events: &[TimerEvent], end_ms: u64) -> Vec<(u64, u64)> {
    let mut pauses = vec![];
    let mut stopped = None;
    for event in events {
        match (event.running, stopped) {
            (false, None) => stopped = Some(event.timestamp_ms),
            (true, Some(at)) => {
                pauses.push((at, event.timestamp_ms.max(at)));
                stopped = None;
            }
            _ => {}
        }
    }
    if let Some(at) = stopped {
        pauses.push((at, end_ms.max(at)));
    }
    pauses
}
pub fn encode(
    start_ms: u64,
    end_ms: u64,
    samples: &[Sample],
    events: &[TimerEvent],
    summary: &Summary,
) -> Vec<u8> {
    let mut data = vec![];
    message(
        &mut data,
        0,
        &[
            enumeration(0, 4),
            short(1, 255),
            short(2, 0),
            long(4, timestamp(start_ms)),
        ],
    );
    // Every moment moves earlier by the time the clock stood still before it.
    let pauses = pauses(events, end_ms);
    let active = |t: u64| {
        t.saturating_sub(
            pauses
                .iter()
                .map(|&(from, to)| t.clamp(from, to) - from)
                .sum::<u64>(),
        )
    };
    let end = active(end_ms);
    timer(&mut data, start_ms, true);
    let mut stops = pauses.iter().map(|&(from, _)| from).peekable();
    let mut distance = None;
    for sample in samples {
        // The bike stopped where the clock did; the sample after it starts again from rest.
        while stops.peek().is_some_and(|at| *at <= sample.timestamp_ms) {
            let at = stops.next().unwrap();
            if let Some(distance) = distance {
                standstill(&mut data, active(at), distance);
            }
        }
        distance = Some(sample.distance);
        let mut fields = vec![long(253, timestamp(active(sample.timestamp_ms)))];
        optional_short(&mut fields, 7, sample.live.power);
        optional_byte(&mut fields, 3, sample.live.heart_rate);
        optional_byte(&mut fields, 4, sample.live.cadence);
        optional_long(&mut fields, 5, centimetres(sample.distance));
        optional_short(&mut fields, 6, Some(sample.speed * 1000.0));
        message(&mut data, 20, &fields);
    }
    for at in stops {
        if let Some(distance) = distance {
            standstill(&mut data, active(at), distance);
        }
    }
    timer(&mut data, end, false);
    // A single lap represents this recording; the preview profile is not a workout player.
    let mut lap = vec![
        short(254, 0),
        long(253, timestamp(end)),
        enumeration(0, 9),
        enumeration(1, 1),
        long(2, timestamp(start_ms)),
        long(
            7,
            end.saturating_sub(start_ms).min((u32::MAX - 1) as u64) as u32,
        ),
        long(8, milliseconds(summary.elapsed)),
        enumeration(25, 2),
        enumeration(39, 6),
    ];
    optional_short(&mut lap, 19, summary.avg_power);
    optional_short(&mut lap, 20, summary.max_power);
    optional_byte(&mut lap, 15, summary.avg_heart_rate);
    optional_byte(&mut lap, 16, summary.max_heart_rate);
    optional_byte(&mut lap, 17, summary.avg_cadence);
    optional_long(&mut lap, 9, centimetres(summary.distance));
    optional_short(&mut lap, 13, summary.avg_speed.map(|s| s * 1000.0));
    optional_short(&mut lap, 14, summary.max_speed.map(|s| s * 1000.0));
    message(&mut data, 19, &lap);
    let mut session = vec![
        short(254, 0),
        long(253, timestamp(end)),
        enumeration(0, 8),
        enumeration(1, 1),
        long(2, timestamp(start_ms)),
        enumeration(5, 2),
        enumeration(6, 6),
        long(
            7,
            end.saturating_sub(start_ms).min((u32::MAX - 1) as u64) as u32,
        ),
        long(8, milliseconds(summary.elapsed)),
        short(25, 0),
        short(26, 1),
    ];
    optional_short(&mut session, 20, summary.avg_power);
    optional_short(&mut session, 21, summary.max_power);
    optional_byte(&mut session, 16, summary.avg_heart_rate);
    optional_byte(&mut session, 17, summary.max_heart_rate);
    optional_byte(&mut session, 18, summary.avg_cadence);
    optional_long(&mut session, 9, centimetres(summary.distance));
    optional_short(&mut session, 14, summary.avg_speed.map(|s| s * 1000.0));
    optional_short(&mut session, 15, summary.max_speed.map(|s| s * 1000.0));
    message(&mut data, 18, &session);
    message(
        &mut data,
        34,
        &[
            long(253, timestamp(end)),
            long(0, milliseconds(summary.elapsed)),
            short(1, 1),
            enumeration(2, 0),
            enumeration(3, 26),
            enumeration(4, 1),
        ],
    );
    let mut file = vec![14, 0x20];
    file.extend(2184u16.to_le_bytes());
    file.extend((data.len() as u32).to_le_bytes());
    file.extend(b".FIT");
    file.extend(crc(&file).to_le_bytes());
    file.extend(data);
    file.extend(crc(&file).to_le_bytes());
    file
}
fn crc(bytes: &[u8]) -> u16 {
    let mut crc = 0u16;
    for byte in bytes {
        crc ^= *byte as u16;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xa001
            } else {
                crc >> 1
            };
        }
    }
    crc
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fit_size_crc_and_missing_measurements() {
        assert_eq!(crc(b"123456789"), 0xbb3d);
        let summary = Summary {
            elapsed: 3.0,
            avg_power: Some(0.0),
            max_power: Some(0.0),
            avg_heart_rate: None,
            max_heart_rate: None,
            avg_cadence: None,
            distance: 12.34,
            avg_speed: Some(2.5),
            max_speed: Some(2.5),
        };
        let sample = Sample {
            timestamp_ms: 1_790_000_000_000,
            elapsed: 0.0,
            pause_index: 0,
            live: crate::recording::Live {
                power: Some(0.0),
                ..Default::default()
            },
            speed: 2.5,
            distance: 12.34,
        };
        let data = encode(
            sample.timestamp_ms,
            sample.timestamp_ms + 3000,
            &[sample],
            &[],
            &summary,
        );
        assert_eq!(crc(&data), 0);
        assert_eq!(crc(&data[..14]), 0);
        assert_eq!(&data[8..12], b".FIT");
        assert_eq!(
            u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize,
            data.len() - 16
        );
        // A record with timestamp, zero power and the simulated distance (cm, uint32) and
        // speed (mm/s, uint16); no zero-valued invented HR/cadence.
        let record = [
            0x40, 0, 0, 20, 0, 4, 253, 4, 0x86, 7, 2, 0x84, 5, 4, 0x86, 6, 2, 0x84, 0,
        ];
        let at = data
            .windows(record.len())
            .position(|w| w == record)
            .expect("record definition");
        let values = &data[at + record.len()..][..12];
        assert_eq!(&values[4..6], &0u16.to_le_bytes(), "Zero power");
        assert_eq!(&values[6..10], &1234u32.to_le_bytes(), "12.34 m");
        assert_eq!(&values[10..12], &2500u16.to_le_bytes(), "2.5 m/s");
    }

    /// The messages of a file this encoder wrote: global number and (field, value) pairs.
    fn messages(file: &[u8]) -> Vec<(u16, Vec<(u8, u64)>)> {
        let data = &file[14..file.len() - 2];
        let (mut at, mut fields, mut out) = (0, vec![], vec![]);
        let mut global = 0;
        while at < data.len() {
            if data[at] == 0x40 {
                // Header, reserved, architecture, global number, field count, fields.
                global = u16::from_le_bytes([data[at + 3], data[at + 4]]);
                let count = data[at + 5] as usize;
                fields = data[at + 6..at + 6 + 3 * count]
                    .chunks(3)
                    .map(|f| (f[0], f[1] as usize))
                    .collect();
                at += 6 + 3 * count;
            } else {
                at += 1;
                let mut values = vec![];
                for &(number, size) in &fields {
                    let mut bytes = [0u8; 8];
                    bytes[..size].copy_from_slice(&data[at..at + size]);
                    values.push((number, u64::from_le_bytes(bytes)));
                    at += size;
                }
                out.push((global, values));
            }
        }
        out
    }
    fn field(values: &[(u8, u64)], number: u8) -> Option<u64> {
        values.iter().find(|(n, _)| *n == number).map(|(_, v)| *v)
    }

    #[test]
    fn pauses_are_left_out_of_the_timeline() {
        let t = 1_790_000_000_000;
        let summary = Summary {
            elapsed: 3.5,
            avg_power: None,
            max_power: None,
            avg_heart_rate: None,
            max_heart_rate: None,
            avg_cadence: None,
            distance: 16.0,
            avg_speed: Some(8.0),
            max_speed: Some(8.0),
        };
        let sample = |at: u64, distance: f64| Sample {
            timestamp_ms: t + at,
            elapsed: 0.0,
            pause_index: 0,
            live: crate::recording::Live {
                power: Some(150.0),
                ..Default::default()
            },
            speed: 8.0,
            distance,
        };
        let event = |at: u64, running: bool| TimerEvent {
            timestamp_ms: t + at,
            running,
        };
        // Ridden 0–1.5 s and 61–63 s, paused in between and from 63 s to the finish at 70 s.
        let file = encode(
            t,
            t + 70_000,
            &[sample(0, 0.0), sample(1_000, 8.0), sample(62_000, 16.0)],
            &[
                event(0, true),
                event(1_500, false),
                event(61_000, true),
                event(63_000, false),
            ],
            &summary,
        );
        let all = messages(&file);
        let start = timestamp(t) as u64;
        let records: Vec<_> = all
            .iter()
            .filter(|(global, _)| *global == 20)
            .map(|(_, v)| {
                (
                    field(v, 253).unwrap() - start,
                    field(v, 5).unwrap(),
                    field(v, 6).unwrap(),
                    field(v, 7).is_some(),
                )
            })
            .collect();
        assert_eq!(
            records,
            [
                (0, 0, 8000, true),
                (1, 800, 8000, true),
                // The bike stops with the clock: zero speed, nothing measured.
                (1, 800, 0, false),
                // 62 s happened 2.5 s into the ride once the pause is cut out.
                (2, 1600, 8000, true),
                (3, 1600, 0, false),
            ]
        );
        let timers: Vec<_> = all
            .iter()
            .filter(|(global, _)| *global == 21)
            .map(|(_, v)| (field(v, 253).unwrap() - start, field(v, 1).unwrap()))
            .collect();
        assert_eq!(
            timers,
            [(0, 0), (3, 4)],
            "One start, one stop at the active end"
        );
        for global in [18, 19] {
            let (_, v) = all.iter().find(|(g, _)| *g == global).unwrap();
            assert_eq!(field(v, 7), Some(3_500), "Elapsed is the active time");
            assert_eq!(field(v, 8), Some(3_500));
            assert_eq!(
                field(v, 2),
                Some(start),
                "The ride still starts when it did"
            );
        }
    }
}
