use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Capabilities {
    pub trainer: bool,
    pub power: bool,
    pub heart_rate: bool,
    pub cadence: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub capabilities: Capabilities,
    pub rssi: Option<i16>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Reading {
    pub power: Option<i16>,
    pub cadence: Option<f32>,
    pub heart_rate: Option<u16>,
}

// Bluetooth FTMS Indoor Bike Data: optional fields follow the flags in order.
// A short packet is rejected rather than fabricating a zero reading.
pub fn indoor_bike_data(bytes: &[u8]) -> Option<Reading> {
    let flags = u16::from_le_bytes(bytes.get(0..2)?.try_into().ok()?);
    let mut offset = 2;
    let mut read = |size: usize| -> Option<&[u8]> {
        let field = bytes.get(offset..offset + size)?;
        offset += size;
        Some(field)
    };
    let mut result = Reading::default();
    if flags & 1 == 0 {
        read(2)?;
    }
    if flags & (1 << 1) != 0 {
        read(2)?;
    }
    if flags & (1 << 2) != 0 {
        result.cadence = Some(u16::from_le_bytes(read(2)?.try_into().ok()?) as f32 / 2.0);
    }
    for (bit, size) in [(3, 2), (4, 3), (5, 2)] {
        if flags & (1 << bit) != 0 {
            read(size)?;
        }
    }
    if flags & (1 << 6) != 0 {
        result.power = Some(i16::from_le_bytes(read(2)?.try_into().ok()?));
    }
    if flags & (1 << 7) != 0 {
        read(2)?;
    }
    if flags & (1 << 8) != 0 {
        read(5)?;
    }
    if flags & (1 << 9) != 0 {
        result.heart_rate = Some(read(1)?[0] as u16);
    }
    for (bit, size) in [(10, 1), (11, 2), (12, 2)] {
        if flags & (1 << bit) != 0 {
            read(size)?;
        }
    }
    Some(result)
}

pub fn heart_rate(bytes: &[u8]) -> Option<Reading> {
    let flags = *bytes.first()?;
    let value = if flags & 1 != 0 {
        u16::from_le_bytes(bytes.get(1..3)?.try_into().ok()?)
    } else {
        *bytes.get(1)? as u16
    };
    Some(Reading {
        heart_rate: Some(value),
        ..Reading::default()
    })
}

pub fn cycling_power(bytes: &[u8]) -> Option<Reading> {
    Some(Reading {
        power: Some(i16::from_le_bytes(bytes.get(2..4)?.try_into().ok()?)),
        ..Reading::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_ftms_optional_fields_and_signed_power() {
        let bytes = [0x44, 0x02, 0x10, 0x27, 180, 0, 250, 0, 143];
        assert_eq!(
            indoor_bike_data(&bytes),
            Some(Reading {
                power: Some(250),
                cadence: Some(90.0),
                heart_rate: Some(143)
            })
        );
        assert_eq!(
            indoor_bike_data(&[0x41, 0, 0xff, 0xff]).unwrap().power,
            Some(-1)
        );
    }
    #[test]
    fn truncated_packets_are_not_zero_samples() {
        let bytes = [0x44, 0x02, 0x10, 0x27, 180, 0, 250, 0, 143];
        for n in 0..bytes.len() {
            assert!(indoor_bike_data(&bytes[..n]).is_none());
        }
        assert!(heart_rate(&[1, 30]).is_none());
        assert!(cycling_power(&[0, 0, 20]).is_none());
    }
    #[test]
    fn supports_both_heart_rate_encodings() {
        assert_eq!(heart_rate(&[0, 145]).unwrap().heart_rate, Some(145));
        assert_eq!(heart_rate(&[1, 44, 1]).unwrap().heart_rate, Some(300));
    }
}
