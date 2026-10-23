import type { ConnectResult, HeartRateAdapter, SensorEvents } from "../adapter";
import type { HeartRateData, SensorConnectOptions } from "../types";
import { BleConnection, connectResultFromError } from "./connection";
import { parseHeartRateMeasurement } from "./parsers";
import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE } from "./services";

/** A heart rate strap over Bluetooth's Heart Rate Service. */
export class BleHeartRateAdapter implements HeartRateAdapter {
  readonly hasDeviceChooser = true;
  private readonly connection = new BleConnection();
  /** Bumped by disconnect(); see BleTrainerAdapter. */
  private generation = 0;

  async connect(
    events: SensorEvents<HeartRateData>,
    options?: SensorConnectOptions,
  ): Promise<ConnectResult> {
    const generation = this.generation;
    try {
      const { device } = await this.connection.connect({
        candidates: [
          {
            serviceUuid: HEART_RATE_SERVICE,
            characteristicUuid: HEART_RATE_MEASUREMENT,
          },
        ],
        acceptAllDevices: options?.acceptAllDevices,
        onData: (event) => {
          const target = event.target as BluetoothRemoteGATTCharacteristic;
          if (!target.value) return;
          try {
            const parsed = parseHeartRateMeasurement(target.value);
            if (parsed) events.onData(parsed);
          } catch (e) {
            // A malformed packet must not take down the subscription.
            console.warn("[BLE] Failed to parse heart rate notification:", e);
          }
        },
        onDisconnect: events.onDisconnect,
      });
      if (generation !== this.generation) {
        // disconnect() overtook the pairing: let go of what it paired with.
        await this.connection.disconnect();
        return { status: "cancelled" };
      }
      return { status: "connected", deviceName: device.name ?? null };
    } catch (e) {
      if (generation !== this.generation) return { status: "cancelled" };
      return connectResultFromError(e, "[BLE HR]");
    }
  }

  async disconnect(): Promise<void> {
    this.generation++;
    await this.connection.disconnect();
  }
}
