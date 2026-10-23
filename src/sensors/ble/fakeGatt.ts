import { vi } from "vitest";

import { toFullUuid } from "./services";

const RESULT_SUCCESS = 0x01;

/**
 * A stand-in for the FTMS Control Point characteristic.
 *
 * `replyWith` decides the result code per op code, and returning `null` means
 * the machine never answers at all — the case the response timeout exists for.
 */
export function createFakeCharacteristic(
  initialReplyWith: (opCode: number) => number | null = () => RESULT_SUCCESS,
) {
  const listeners: ((event: Event) => void)[] = [];
  const writes: number[][] = [];
  let replyWith = initialReplyWith;

  const stopNotifications = vi.fn((): Promise<void> => Promise.resolve());
  const writeValueWithResponse = vi.fn((payload: Uint8Array): Promise<void> => {
    writes.push([...payload]);
    const result = replyWith(payload[0]);
    if (result != null) {
      // Real indications arrive after the write settles, never during it.
      queueMicrotask(() => notify(payload[0], result));
    }
    return Promise.resolve();
  });

  const characteristic = {
    value: null as DataView | null,
    startNotifications: (): Promise<void> => Promise.resolve(),
    stopNotifications,
    addEventListener: (_type: string, listener: (event: Event) => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: Event) => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    writeValueWithResponse,
  };

  function notifyRaw(bytes: number[]) {
    characteristic.value = new DataView(Uint8Array.from(bytes).buffer);
    for (const listener of [...listeners]) {
      listener({ target: characteristic } as unknown as Event);
    }
  }

  function notify(opCode: number, result: number) {
    notifyRaw([0x80, opCode, result]);
  }

  return {
    characteristic:
      characteristic as unknown as BluetoothRemoteGATTCharacteristic,
    // Exposed directly rather than reached through `characteristic`, so tests
    // never hold an unbound method reference.
    writeValueWithResponse,
    stopNotifications,
    /** Op codes written, in order. */
    opCodes: () => writes.map((write) => write[0]),
    writes,
    notify,
    notifyRaw,
    /** Changes how the machine answers from the next write onwards. */
    setReplyWith: (next: (opCode: number) => number | null) => {
      replyWith = next;
    },
    listenerCount: () => listeners.length,
  };
}

/** A characteristic that notifies measurements, or answers reads. */
export function createMeasurementCharacteristic(
  uuid: number,
  readBytes: number[] = [],
) {
  const listeners: ((event: Event) => void)[] = [];
  const characteristic = {
    uuid: toFullUuid(uuid),
    value: null as DataView | null,
    readValue: () =>
      Promise.resolve(new DataView(Uint8Array.from(readBytes).buffer)),
    startNotifications: () => Promise.resolve(),
    stopNotifications: () => Promise.resolve(),
    addEventListener: (_type: string, listener: (event: Event) => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: string, listener: (event: Event) => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  return {
    characteristic:
      characteristic as unknown as BluetoothRemoteGATTCharacteristic,
    notify(bytes: number[]) {
      characteristic.value = new DataView(Uint8Array.from(bytes).buffer);
      for (const listener of [...listeners]) {
        listener({ target: characteristic } as unknown as Event);
      }
    },
  };
}

/** GATT services by UUID, each a map of its characteristics by UUID. */
type FakeServices = Record<
  number,
  Record<number, BluetoothRemoteGATTCharacteristic>
>;

function notFound(what: string) {
  return new DOMException(`No ${what} matching UUID found.`, "NotFoundError");
}

/** A Bluetooth device exposing `services`, as `requestDevice` returns it. */
export function createFakeDevice(name: string, services: FakeServices) {
  const disconnectListeners: (() => void)[] = [];
  const dropConnection = () => {
    server.connected = false;
    for (const listener of [...disconnectListeners]) listener();
  };
  const server = {
    connected: false,
    connect: () => {
      server.connected = true;
      return Promise.resolve(server);
    },
    // Chrome reports our own disconnect as "gattserverdisconnected" too.
    disconnect: dropConnection,
    getPrimaryService: (serviceUuid: number) => {
      const characteristics = services[serviceUuid];
      if (!characteristics) return Promise.reject(notFound("Services"));
      return Promise.resolve({
        getCharacteristic: (characteristicUuid: number) =>
          characteristicUuid in characteristics
            ? Promise.resolve(characteristics[characteristicUuid])
            : Promise.reject(notFound("Characteristics")),
      });
    },
  };
  const device = {
    name,
    id: name,
    gatt: server,
    addEventListener: (_type: string, listener: () => void) => {
      disconnectListeners.push(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      const index = disconnectListeners.indexOf(listener);
      if (index >= 0) disconnectListeners.splice(index, 1);
    },
  };
  return {
    device: device as unknown as BluetoothDevice,
    /** The device powered off or went out of range. */
    dropConnection,
  };
}

/**
 * Installs a `navigator.bluetooth` whose chooser hands back `device`, or
 * rejects as Chrome does when the rider dismisses it.
 */
export function stubBluetooth(device: BluetoothDevice | "dismissed") {
  const requestDevice = vi.fn((_options: RequestDeviceOptions) =>
    device === "dismissed"
      ? Promise.reject(
          new DOMException(
            "User cancelled the requestDevice() chooser.",
            "NotFoundError",
          ),
        )
      : Promise.resolve(device),
  );
  vi.stubGlobal("navigator", { bluetooth: { requestDevice } });
  return requestDevice;
}
