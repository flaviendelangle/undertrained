import { MAX_TARGET_POWER_WATTS } from "../types";

/**
 * FTMS Control Point (0x2AD9) protocol wrapper.
 *
 * Op codes:
 * - 0x00  Request Control
 * - 0x01  Reset
 * - 0x05  Set Target Power (SINT16LE watts)
 * - 0x07  Start or Resume
 *
 * Response notifications: [0x80, requestOpCode, resultCode]
 *   resultCode 0x01 = success
 *
 * Every command waits for its response notification rather than for the GATT
 * write to complete. The machine grants control asynchronously, so resolving
 * on the write would let a Set Target Power race ahead of the grant and be
 * rejected. A non-success result also drops the cached grant, because a
 * machine that reclaims control (its own stop/pause, or a control-point
 * timeout) would otherwise reject every later command while this class kept
 * believing it still had control.
 */
const OP_REQUEST_CONTROL = 0x00;
const OP_RESET = 0x01;
const OP_SET_TARGET_POWER = 0x05;
const OP_START_OR_RESUME = 0x07;

const RESULT_SUCCESS = 0x01;
const RESPONSE_PREFIX = 0x80;

/** How long to wait for the machine's response notification. */
const RESPONSE_TIMEOUT_MS = 3_000;

interface PendingRequest {
  opCode: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class FtmsControlPoint {
  private characteristic: BluetoothRemoteGATTCharacteristic;
  private hasControl = false;
  private hasStarted = false;
  private pending: PendingRequest | null = null;
  private responseHandler: ((event: Event) => void) | null = null;
  private onResponse?: (opCode: number, result: number) => void;

  constructor(characteristic: BluetoothRemoteGATTCharacteristic) {
    this.characteristic = characteristic;
  }

  async startNotifications(
    onResponse?: (opCode: number, result: number) => void,
  ): Promise<void> {
    this.onResponse = onResponse;
    await this.characteristic.startNotifications();
    this.responseHandler = (event: Event) => {
      const dv = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!dv || dv.byteLength < 3 || dv.getUint8(0) !== RESPONSE_PREFIX) {
        return;
      }
      const opCode = dv.getUint8(1);
      const result = dv.getUint8(2);
      this.onResponse?.(opCode, result);

      if (result !== RESULT_SUCCESS) {
        // The machine no longer honours our grant — re-request it next time.
        this.hasControl = false;
        this.hasStarted = false;
      }

      if (this.pending?.opCode !== opCode) return;
      this.settle(
        result === RESULT_SUCCESS
          ? null
          : new Error(
              `FTMS command 0x${opCode.toString(16)} rejected (result 0x${result.toString(16)})`,
            ),
      );
    };
    this.characteristic.addEventListener(
      "characteristicvaluechanged",
      this.responseHandler,
    );
  }

  private settle(error: Error | null): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timeout);
    if (error) {
      pending.reject(error);
    } else {
      pending.resolve();
    }
  }

  /** Writes a command and resolves once the machine acknowledges it. */
  private async request(
    opCode: number,
    payload: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    // The control point is a single-request-at-a-time resource; a queued
    // command would be answered by a response we can no longer attribute.
    this.settle(new Error("Superseded by a newer FTMS command"));

    const acknowledged = new Promise<void>((resolve, reject) => {
      this.pending = {
        opCode,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.settle(
            new Error(
              `FTMS command 0x${opCode.toString(16)} timed out after ${RESPONSE_TIMEOUT_MS}ms`,
            ),
          );
        }, RESPONSE_TIMEOUT_MS),
      };
    });

    try {
      await this.characteristic.writeValueWithResponse(payload);
    } catch (error) {
      this.settle(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    return acknowledged;
  }

  async requestControl(): Promise<void> {
    await this.request(
      OP_REQUEST_CONTROL,
      new Uint8Array([OP_REQUEST_CONTROL]),
    );
    this.hasControl = true;
    // A fresh grant says nothing about the machine's training status, and the
    // spec has Reset put it back to Idle (§4.16.2.2). Re-send Start or Resume
    // before the next target rather than trusting a flag from the last grant.
    this.hasStarted = false;
  }

  /**
   * Moves the machine out of Idle so targets actually take effect.
   *
   * The spec only requires control permission for Set Target Power, but a
   * fitness machine sits in Idle until told to start, and trainers in the wild
   * ignore or reject a target written before that — Zwift's own control
   * sequence is Request Control (0x00), Start or Resume (0x07), then Set
   * Target Power (0x05). A machine that has no use for the op code answers
   * "Op Code not supported", which is not a reason to abandon ERG.
   */
  private async ensureStarted(): Promise<void> {
    if (this.hasStarted) return;
    try {
      await this.request(
        OP_START_OR_RESUME,
        new Uint8Array([OP_START_OR_RESUME]),
      );
    } catch (e) {
      console.warn("[BLE] FTMS Start or Resume was not accepted:", e);
    }
    // Set even on failure so a machine that doesn't implement the op code is
    // not re-asked on every target change. `requestControl` clears it again,
    // so a genuine loss of control still triggers one retry.
    this.hasStarted = true;
  }

  async setTargetPower(watts: number): Promise<void> {
    if (!this.hasControl) {
      await this.requestControl();
    }
    await this.ensureStarted();
    const clamped = Math.max(
      0,
      Math.min(MAX_TARGET_POWER_WATTS, Math.round(watts)),
    );
    const buf = new ArrayBuffer(3);
    const dv = new DataView(buf);
    dv.setUint8(0, OP_SET_TARGET_POWER);
    // Set Target Power takes a SINT16; the value is clamped non-negative, so
    // the encoding is identical, but keep the signed writer to match the spec.
    dv.setInt16(1, clamped, true);
    await this.request(OP_SET_TARGET_POWER, new Uint8Array(buf));
  }

  /**
   * Returns the machine to its default state, ending ERG mode. Safe to call
   * when the trainer has already gone away.
   */
  async reset(): Promise<void> {
    try {
      await this.request(OP_RESET, new Uint8Array([OP_RESET]));
    } catch {
      // Trainer may already be disconnected, or may not acknowledge a reset.
    }
    this.hasControl = false;
    this.hasStarted = false;
  }

  async dispose(): Promise<void> {
    this.settle(new Error("FTMS control point disposed"));
    if (this.responseHandler) {
      this.characteristic.removeEventListener(
        "characteristicvaluechanged",
        this.responseHandler,
      );
      this.responseHandler = null;
    }
    try {
      await this.characteristic.stopNotifications();
    } catch {
      // Already disconnected
    }
    this.hasControl = false;
    this.hasStarted = false;
  }
}
