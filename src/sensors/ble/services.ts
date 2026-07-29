// BLE GATT Service UUIDs
export const HEART_RATE_SERVICE = 0x180d;
export const FITNESS_MACHINE_SERVICE = 0x1826;
export const CYCLING_POWER_SERVICE = 0x1818;

// BLE GATT Characteristic UUIDs
export const HEART_RATE_MEASUREMENT = 0x2a37;
export const INDOOR_BIKE_DATA = 0x2ad2;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;
export const FTMS_CONTROL_POINT = 0x2ad9;
export const FITNESS_MACHINE_FEATURE = 0x2acc;

/**
 * Expands a 16-bit GATT UUID to the canonical 128-bit form Web Bluetooth
 * reports on `characteristic.uuid`, for comparing against a notifying
 * characteristic.
 */
export function toFullUuid(shortUuid: number): string {
  return `0000${shortUuid.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`;
}
