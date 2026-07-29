import type { HeartRateData, TrainerData } from "../types";

/**
 * FTMS and CPS payloads describe their own layout through a flags field, so a
 * firmware that sets a flag without appending the matching bytes would make
 * `getUintN` throw from inside the BLE notification handler — where nothing
 * catches it and the connection silently stops delivering data. Every
 * flag-gated read is therefore bounds-checked, and a truncated packet yields
 * the fields we did manage to read instead of an exception.
 */
function fits(dataView: DataView, offset: number, bytes: number): boolean {
  return offset + bytes <= dataView.byteLength;
}

/**
 * Parses the Heart Rate Measurement BLE characteristic (0x2A37).
 *
 * Byte layout:
 *  - Byte 0: Flags
 *    - Bit 0: HR format (0 = UINT8, 1 = UINT16)
 *    - Bit 1: Sensor Contact Status — 1 = skin contact detected
 *    - Bit 2: Sensor Contact Support — 1 = the sensor implements the feature
 *    - Bit 3: Energy expended present
 *    - Bit 4: RR-interval present
 *  - Byte 1+: HR value, then optional fields in order
 *
 * Bits 1 and 2 are easy to transpose: the *status* comes before the *support*
 * bit, so contact status must only be trusted when bit 2 says the sensor
 * implements the feature at all. See the Heart Rate Service spec, §3.1.1.
 */
export function parseHeartRateMeasurement(
  dataView: DataView,
): HeartRateData | null {
  if (dataView.byteLength < 2) return null;

  const flags = dataView.getUint8(0);
  const is16Bit = (flags & 0x01) === 1;
  const sensorContactDetected = ((flags >> 1) & 0x01) === 1;
  const sensorContactSupported = ((flags >> 2) & 0x01) === 1;
  const hasEnergyExpended = ((flags >> 3) & 0x01) === 1;
  const hasRrInterval = ((flags >> 4) & 0x01) === 1;

  let offset = 1;

  if (!fits(dataView, offset, is16Bit ? 2 : 1)) return null;
  const heartRate = is16Bit
    ? dataView.getUint16(offset, true)
    : dataView.getUint8(offset);
  offset += is16Bit ? 2 : 1;

  let energyExpended: number | undefined;
  if (hasEnergyExpended && fits(dataView, offset, 2)) {
    energyExpended = dataView.getUint16(offset, true);
    offset += 2;
  }

  const rrIntervals: number[] = [];
  if (hasRrInterval) {
    while (fits(dataView, offset, 2)) {
      // RR intervals are in 1/1024 seconds, convert to ms
      const rrRaw = dataView.getUint16(offset, true);
      rrIntervals.push((rrRaw / 1024) * 1000);
      offset += 2;
    }
  }

  return {
    heartRate,
    sensorContact: sensorContactSupported ? sensorContactDetected : undefined,
    energyExpended,
    rrIntervals: rrIntervals.length > 0 ? rrIntervals : undefined,
  };
}

/**
 * Parses the FTMS Indoor Bike Data characteristic (0x2AD2).
 *
 * Uses a 16-bit flags field to determine which data fields are present.
 * Fields appear in a fixed order, each conditionally present based on flags.
 */
export function parseIndoorBikeData(dataView: DataView): TrainerData | null {
  if (dataView.byteLength < 2) return null;

  const flags = dataView.getUint16(0, true);
  let offset = 2;

  const result: TrainerData = {};

  // Bit 0: More Data - if 0, instantaneous speed IS present
  if ((flags & 0x01) === 0) {
    if (!fits(dataView, offset, 2)) return result;
    result.speed = (dataView.getUint16(offset, true) * 0.01) / 3.6; // 0.01 km/h → m/s
    offset += 2;
  }

  // Bit 1: Average speed present
  if (flags & 0x02) {
    if (!fits(dataView, offset, 2)) return result;
    offset += 2; // skip average speed
  }

  // Bit 2: Instantaneous cadence present
  if (flags & 0x04) {
    if (!fits(dataView, offset, 2)) return result;
    result.cadence = dataView.getUint16(offset, true) * 0.5; // rpm
    offset += 2;
  }

  // Bit 3: Average cadence present
  if (flags & 0x08) {
    if (!fits(dataView, offset, 2)) return result;
    offset += 2; // skip
  }

  // Bit 4: Total distance present (3 bytes)
  if (flags & 0x10) {
    if (!fits(dataView, offset, 3)) return result;
    result.distance =
      dataView.getUint16(offset, true) + (dataView.getUint8(offset + 2) << 16); // meters
    offset += 3;
  }

  // Bit 5: Resistance level present
  if (flags & 0x20) {
    if (!fits(dataView, offset, 2)) return result;
    result.resistanceLevel = dataView.getInt16(offset, true);
    offset += 2;
  }

  // Bit 6: Instantaneous power present
  if (flags & 0x40) {
    if (!fits(dataView, offset, 2)) return result;
    result.power = dataView.getInt16(offset, true); // watts
    offset += 2;
  }

  // Bit 7: Average power present
  if (flags & 0x80) {
    if (!fits(dataView, offset, 2)) return result;
    offset += 2; // skip
  }

  // Bit 8: Expended energy present (total 2B + per hour 2B + per minute 1B)
  if (flags & 0x100) {
    if (!fits(dataView, offset, 5)) return result;
    offset += 5; // skip
  }

  // Bit 9: Heart rate present
  if (flags & 0x200) {
    if (!fits(dataView, offset, 1)) return result;
    result.heartRate = dataView.getUint8(offset); // bpm
    offset += 1;
  }

  return result;
}

/**
 * Creates a parser for the Cycling Power Measurement characteristic (0x2A63).
 *
 * Instantaneous power is always present at offset 2 (Int16LE). Optional crank
 * revolution data is used to compute cadence, which needs the previous
 * notification as a reference — that state lives in the closure, so each
 * connection gets its own and reconnecting to a different power meter can
 * never derive cadence from the old device's crank counter.
 */
export function createCyclingPowerParser(): (
  dataView: DataView,
) => TrainerData | null {
  let prevCrankRevolutions: number | null = null;
  let prevCrankEventTime: number | null = null;

  return (dataView: DataView): TrainerData | null => {
    if (dataView.byteLength < 4) return null;

    const flags = dataView.getUint16(0, true);
    let offset = 2;

    const result: TrainerData = {};

    // Instantaneous power is always present
    result.power = dataView.getInt16(offset, true); // watts
    offset += 2;

    // Bit 0: Pedal power balance present
    if (flags & 0x01) {
      if (!fits(dataView, offset, 1)) return result;
      offset += 1;
    }

    // Bit 1: Pedal power balance reference
    // (no data field, just modifies interpretation)

    // Bit 2: Accumulated torque present
    if (flags & 0x04) {
      if (!fits(dataView, offset, 2)) return result;
      offset += 2;
    }

    // Bit 3: Accumulated torque source
    // (no data field)

    // Bit 4: Wheel revolution data present
    if (flags & 0x10) {
      if (!fits(dataView, offset, 6)) return result;
      offset += 6; // cumulative wheel revolutions (4B) + last wheel event time (2B)
    }

    // Bit 5: Crank revolution data present
    if (flags & 0x20) {
      if (!fits(dataView, offset, 4)) return result;
      const crankRevolutions = dataView.getUint16(offset, true);
      const crankEventTime = dataView.getUint16(offset + 2, true); // 1/1024 seconds

      if (
        prevCrankRevolutions !== null &&
        prevCrankEventTime !== null &&
        crankRevolutions !== prevCrankRevolutions
      ) {
        let revDelta = crankRevolutions - prevCrankRevolutions;
        let timeDelta = crankEventTime - prevCrankEventTime;

        // Handle rollover (UINT16 wraps at 65535)
        if (revDelta < 0) revDelta += 65536;
        if (timeDelta < 0) timeDelta += 65536;

        if (timeDelta > 0) {
          // Convert: (revolutions / (time_in_1024ths / 1024)) * 60 = RPM
          result.cadence = (revDelta / (timeDelta / 1024)) * 60;
        }
      }

      prevCrankRevolutions = crankRevolutions;
      prevCrankEventTime = crankEventTime;
      offset += 4;
    }

    return result;
  };
}
