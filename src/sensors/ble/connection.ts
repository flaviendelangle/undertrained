import type { ConnectionState } from "../types";

export interface BleDeviceInfo {
  name: string | null;
  id: string | null;
  state: ConnectionState;
}

/** A service/characteristic pair the caller knows how to read. */
export interface BleServiceCandidate {
  serviceUuid: number;
  characteristicUuid: number;
}

export interface BleConnectResult {
  device: BluetoothDevice;
  /** Which of the offered candidates the chosen device actually exposes. */
  serviceUuid: number;
}

/**
 * The rider picked a device that speaks none of the protocols we asked for.
 *
 * Only reachable from the unfiltered chooser, where every nearby device is
 * listed — worth distinguishing from a generic failure so the UI can say
 * "that isn't a trainer" instead of "connection failed".
 */
export class UnsupportedBleDeviceError extends Error {
  constructor(candidates: BleServiceCandidate[]) {
    super(
      `Device exposes none of the expected services: ${candidates
        .map((c) => `0x${c.serviceUuid.toString(16)}`)
        .join(", ")}`,
    );
    this.name = "UnsupportedBleDeviceError";
  }
}

export class BleConnection {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onDataCallback: ((event: Event) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;
  private disconnectHandler: (() => void) | null = null;

  get deviceInfo(): BleDeviceInfo {
    return {
      name: this.device?.name ?? null,
      id: this.device?.id ?? null,
      state: this.device?.gatt?.connected ? "connected" : "disconnected",
    };
  }

  /**
   * Pairs with a device and subscribes to the first candidate service it
   * exposes.
   *
   * `candidates` are offered together in a single `requestDevice` chooser and
   * then probed in order against the chosen device. Prompting once per
   * protocol instead would be unusable: a chooser filtered on a service the
   * rider's hardware doesn't implement simply lists nothing, and cancelling it
   * rejects with `NotFoundError` — indistinguishable from "no such device", so
   * there is no way to tell a real cancellation from "try the next protocol".
   *
   * `acceptAllDevices` drops the service filter and lists every nearby device.
   * Filtering relies on the service UUID being present in the *advertisement*,
   * which some trainers omit even though they implement the service, leaving
   * them invisible in the normal chooser. The Web Bluetooth API forbids
   * combining `filters` with `acceptAllDevices`, so this is a separate mode
   * rather than an extra filter.
   */
  async connect(params: {
    candidates: BleServiceCandidate[];
    optionalServices?: number[];
    acceptAllDevices?: boolean;
    onData: (event: Event) => void;
    onDisconnect: () => void;
  }): Promise<BleConnectResult> {
    const {
      candidates,
      optionalServices = [],
      acceptAllDevices = false,
      onData,
      onDisconnect,
    } = params;

    if (candidates.length === 0) {
      throw new Error("No service candidates provided");
    }

    // Never leak a previous pairing: a second connect() on the same instance
    // would otherwise overwrite `device` while its GATT link and
    // `gattserverdisconnected` listener stayed live and unreachable.
    await this.disconnect();

    this.onDataCallback = onData;
    this.onDisconnectCallback = onDisconnect;

    // Services reached via getPrimaryService must be listed here whichever
    // mode we are in — a filter grants access implicitly, but only to devices
    // it matched, and in unfiltered mode nothing is granted implicitly at all.
    const allowedServices = [
      ...candidates.map((candidate) => candidate.serviceUuid),
      ...optionalServices,
    ];

    this.device = await navigator.bluetooth.requestDevice(
      acceptAllDevices
        ? { acceptAllDevices: true, optionalServices: allowedServices }
        : {
            filters: candidates.map((candidate) => ({
              services: [candidate.serviceUuid],
            })),
            optionalServices: allowedServices,
          },
    );

    this.disconnectHandler = () => {
      this.onDisconnectCallback?.();
    };
    this.device.addEventListener(
      "gattserverdisconnected",
      this.disconnectHandler,
    );

    try {
      this.server = await this.device.gatt!.connect();

      let matched: BleServiceCandidate | null = null;
      let service: BluetoothRemoteGATTService | null = null;
      for (const candidate of candidates) {
        try {
          service = await this.server.getPrimaryService(candidate.serviceUuid);
          matched = candidate;
          break;
        } catch {
          // Device doesn't expose this service — try the next candidate.
        }
      }

      if (!matched || !service) {
        throw new UnsupportedBleDeviceError(candidates);
      }

      this.characteristic = await service.getCharacteristic(
        matched.characteristicUuid,
      );

      await this.characteristic.startNotifications();
      this.characteristic.addEventListener(
        "characteristicvaluechanged",
        this.onDataCallback,
      );

      return { device: this.device, serviceUuid: matched.serviceUuid };
    } catch (error) {
      // Leave the instance in a clean state so the next connect() starts fresh.
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Returns a characteristic from the already-connected GATT server.
   * The caller is responsible for using it (write, subscribe, etc).
   */
  async getCharacteristic(
    serviceUuid: number,
    characteristicUuid: number,
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    if (!this.server?.connected) {
      throw new Error("Not connected to GATT server");
    }
    const service = await this.server.getPrimaryService(serviceUuid);
    return service.getCharacteristic(characteristicUuid);
  }

  async disconnect(): Promise<void> {
    if (this.characteristic && this.onDataCallback) {
      try {
        this.characteristic.removeEventListener(
          "characteristicvaluechanged",
          this.onDataCallback,
        );
        await this.characteristic.stopNotifications();
      } catch {
        // Device may already be disconnected
      }
    }

    if (this.device && this.disconnectHandler) {
      this.device.removeEventListener(
        "gattserverdisconnected",
        this.disconnectHandler,
      );
    }

    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.onDataCallback = null;
    this.disconnectHandler = null;
  }
}
