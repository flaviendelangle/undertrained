//! Minimal FIT activity encoder, following Garmin's public FIT protocol/profile.
//! Only measured fields are exported. No invented distance, GPS or speed.
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
fn milliseconds(seconds: f64) -> u32 {
    (seconds * 1000.0).round().clamp(0.0, (u32::MAX - 1) as f64) as u32
}
fn timer(data: &mut Vec<u8>, event: &TimerEvent) {
    message(
        data,
        21,
        &[
            long(253, timestamp(event.timestamp_ms)),
            enumeration(0, 0),
            enumeration(1, if event.running { 0 } else { 4 }),
        ],
    );
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
    // Interleave timer events and samples so pause/resume is preserved by importers.
    let mut events = events.iter().peekable();
    for sample in samples {
        while events
            .peek()
            .is_some_and(|e| e.timestamp_ms <= sample.timestamp_ms)
        {
            timer(&mut data, events.next().unwrap());
        }
        let mut fields = vec![long(253, timestamp(sample.timestamp_ms))];
        optional_short(&mut fields, 7, sample.live.power);
        optional_byte(&mut fields, 3, sample.live.heart_rate);
        optional_byte(&mut fields, 4, sample.live.cadence);
        message(&mut data, 20, &fields);
    }
    for event in events {
        timer(&mut data, event);
    }
    // A single lap represents this recording; the preview profile is not a workout player.
    let mut lap = vec![
        short(254, 0),
        long(253, timestamp(end_ms)),
        enumeration(0, 9),
        enumeration(1, 1),
        long(2, timestamp(start_ms)),
        long(
            7,
            end_ms.saturating_sub(start_ms).min((u32::MAX - 1) as u64) as u32,
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
    message(&mut data, 19, &lap);
    let mut session = vec![
        short(254, 0),
        long(253, timestamp(end_ms)),
        enumeration(0, 8),
        enumeration(1, 1),
        long(2, timestamp(start_ms)),
        enumeration(5, 2),
        enumeration(6, 6),
        long(
            7,
            end_ms.saturating_sub(start_ms).min((u32::MAX - 1) as u64) as u32,
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
    message(&mut data, 18, &session);
    message(
        &mut data,
        34,
        &[
            long(253, timestamp(end_ms)),
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
        };
        let sample = Sample {
            timestamp_ms: 1_790_000_000_000,
            elapsed: 0.0,
            pause_index: 0,
            live: crate::recording::Live {
                power: Some(0.0),
                ..Default::default()
            },
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
        // A record with only timestamp and zero power, no zero-valued invented HR/cadence.
        assert!(
            data.windows(12)
                .any(|w| w == [0x40, 0, 0, 20, 0, 2, 253, 4, 0x86, 7, 2, 0x84])
        );
    }
}
