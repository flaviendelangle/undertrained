import { describe, expect, it, vi } from "vitest";

import { FtmsControlPoint } from "./ftmsControl";

const OP_REQUEST_CONTROL = 0x00;
const OP_RESET = 0x01;
const OP_SET_TARGET_POWER = 0x05;
const OP_START_OR_RESUME = 0x07;

const RESULT_SUCCESS = 0x01;
const RESULT_OP_CODE_NOT_SUPPORTED = 0x02;
const RESULT_CONTROL_NOT_PERMITTED = 0x05;

/**
 * A stand-in for the FTMS Control Point characteristic.
 *
 * `replyWith` decides the result code per op code, and returning `null` means
 * the machine never answers at all — the case the response timeout exists for.
 */
function createFakeCharacteristic(
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

/** Lets pending microtasks and the queued write settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function connected(
  replyWith?: (opCode: number) => number | null,
): Promise<[FtmsControlPoint, ReturnType<typeof createFakeCharacteristic>]> {
  const fake = createFakeCharacteristic(replyWith);
  const control = new FtmsControlPoint(fake.characteristic);
  await control.startNotifications();
  return [control, fake];
}

describe("FtmsControlPoint", () => {
  it("requests control and starts the machine before the first target", async () => {
    const [control, fake] = await connected();

    await control.setTargetPower(200);

    // Zwift's sequence: a machine sits in Idle and ignores targets written
    // before Start or Resume.
    expect(fake.opCodes()).toEqual([
      OP_REQUEST_CONTROL,
      OP_START_OR_RESUME,
      OP_SET_TARGET_POWER,
    ]);
  });

  it("writes the target as a little-endian SINT16 after the op code", async () => {
    const [control, fake] = await connected();

    await control.setTargetPower(300);

    expect(fake.writes.at(-1)).toEqual([OP_SET_TARGET_POWER, 0x2c, 0x01]);
  });

  it("clamps the target to the app's ceiling", async () => {
    const [control, fake] = await connected();

    await control.setTargetPower(5000);

    const [, low, high] = fake.writes.at(-1)!;
    expect(low + (high << 8)).toBe(1000);
  });

  it("sends only the target on a repeat call", async () => {
    const [control, fake] = await connected();

    await control.setTargetPower(200);
    await control.setTargetPower(210);

    expect(fake.opCodes()).toEqual([
      OP_REQUEST_CONTROL,
      OP_START_OR_RESUME,
      OP_SET_TARGET_POWER,
      OP_SET_TARGET_POWER,
    ]);
  });

  // Regression: dropping the control grant on *any* failure made the machine
  // re-negotiate on every target change, because Request Control clears the
  // started flag that the unsupported op code had just set.
  it("does not re-negotiate when the machine has no Start or Resume", async () => {
    const [control, fake] = await connected((opCode) =>
      opCode === OP_START_OR_RESUME
        ? RESULT_OP_CODE_NOT_SUPPORTED
        : RESULT_SUCCESS,
    );

    await control.setTargetPower(200);
    await control.setTargetPower(210);
    await control.setTargetPower(220);

    expect(fake.opCodes()).toEqual([
      OP_REQUEST_CONTROL,
      OP_START_OR_RESUME,
      OP_SET_TARGET_POWER,
      OP_SET_TARGET_POWER,
      OP_SET_TARGET_POWER,
    ]);
  });

  it("re-requests control after the machine takes it back", async () => {
    let reclaimed = false;
    const [control, fake] = await connected((opCode) => {
      if (opCode === OP_SET_TARGET_POWER && !reclaimed) {
        reclaimed = true;
        return RESULT_CONTROL_NOT_PERMITTED;
      }
      return RESULT_SUCCESS;
    });

    // The rider pressed stop on the trainer itself: the target is refused...
    await expect(control.setTargetPower(200)).rejects.toThrow(/0x5 rejected/);
    // ...and the next one negotiates from scratch instead of writing into the
    // void forever.
    await expect(control.setTargetPower(210)).resolves.toBeUndefined();

    expect(fake.opCodes()).toEqual([
      OP_REQUEST_CONTROL,
      OP_START_OR_RESUME,
      OP_SET_TARGET_POWER,
      OP_REQUEST_CONTROL,
      OP_START_OR_RESUME,
      OP_SET_TARGET_POWER,
    ]);
  });

  it("rejects when the machine refuses the target", async () => {
    const [control] = await connected((opCode) =>
      opCode === OP_SET_TARGET_POWER ? 0x04 : RESULT_SUCCESS,
    );

    await expect(control.setTargetPower(200)).rejects.toThrow(/0x5 rejected/);
  });

  it("ignores a response for a command it did not send", async () => {
    const [control, fake] = await connected();
    // Get the handshake out of the way, then go silent so a target stays
    // pending while we push unrelated notifications at it.
    await control.setTargetPower(200);
    fake.setReplyWith(() => null);

    const pending = control.setTargetPower(210);
    await flush();
    // A stray Reset acknowledgement must not resolve the pending target.
    fake.notify(OP_RESET, RESULT_SUCCESS);
    fake.notify(OP_SET_TARGET_POWER, RESULT_SUCCESS);

    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects a command the machine never answers", async () => {
    vi.useFakeTimers();
    try {
      const [control] = await connected((opCode) =>
        opCode === OP_REQUEST_CONTROL ? null : RESULT_SUCCESS,
      );

      const pending = control.setTargetPower(200);
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(3_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a superseded command rather than mis-attributing the response", async () => {
    const [control, fake] = await connected();
    await control.setTargetPower(200);
    fake.setReplyWith((opCode) =>
      opCode === OP_SET_TARGET_POWER ? null : RESULT_SUCCESS,
    );

    const superseded = control.setTargetPower(210);
    await flush();
    const assertion = expect(superseded).rejects.toThrow(/Superseded/);
    await control.reset();
    await assertion;
  });

  it("does not leave an unhandled rejection when the write itself fails", async () => {
    const [control, fake] = await connected();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      fake.writeValueWithResponse.mockRejectedValue(
        new Error("GATT Server is disconnected."),
      );

      await expect(control.setTargetPower(200)).rejects.toThrow(
        "GATT Server is disconnected.",
      );
      // Give the microtask queue a chance to report an orphaned rejection.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("swallows a failing reset so disconnect paths stay quiet", async () => {
    const [control, fake] = await connected(() => null);
    fake.writeValueWithResponse.mockRejectedValue(
      new Error("GATT Server is disconnected."),
    );

    await expect(control.reset()).resolves.toBeUndefined();
  });

  it("re-negotiates after a reset, since Reset returns the machine to Idle", async () => {
    const [control, fake] = await connected();

    await control.setTargetPower(200);
    await control.reset();
    await control.setTargetPower(210);

    expect(fake.opCodes()).toEqual([
      OP_REQUEST_CONTROL,
      OP_START_OR_RESUME,
      OP_SET_TARGET_POWER,
      OP_RESET,
      OP_REQUEST_CONTROL,
      OP_START_OR_RESUME,
      OP_SET_TARGET_POWER,
    ]);
  });

  it("reports every response to the caller's listener", async () => {
    const seen: [number, number][] = [];
    const fake = createFakeCharacteristic((opCode) =>
      opCode === OP_START_OR_RESUME
        ? RESULT_OP_CODE_NOT_SUPPORTED
        : RESULT_SUCCESS,
    );
    const control = new FtmsControlPoint(fake.characteristic);
    await control.startNotifications((opCode, result) =>
      seen.push([opCode, result]),
    );

    await control.setTargetPower(200);

    expect(seen).toEqual([
      [OP_REQUEST_CONTROL, RESULT_SUCCESS],
      [OP_START_OR_RESUME, RESULT_OP_CODE_NOT_SUPPORTED],
      [OP_SET_TARGET_POWER, RESULT_SUCCESS],
    ]);
  });

  it("ignores malformed notifications", async () => {
    const [control, fake] = await connected();
    await control.setTargetPower(200);
    fake.setReplyWith(() => null);

    const pending = control.setTargetPower(210);
    await flush();
    // Wrong prefix — must not settle the request.
    fake.notifyRaw([0x00, OP_SET_TARGET_POWER, RESULT_SUCCESS]);
    // Too short — must not settle it either.
    fake.notifyRaw([0x80, OP_SET_TARGET_POWER]);
    // The real thing does.
    fake.notify(OP_SET_TARGET_POWER, RESULT_SUCCESS);

    await expect(pending).resolves.toBeUndefined();
  });

  it("detaches its listener on dispose", async () => {
    const [control, fake] = await connected();

    expect(fake.listenerCount()).toBe(1);
    await control.dispose();

    expect(fake.listenerCount()).toBe(0);
    expect(fake.stopNotifications).toHaveBeenCalled();
  });

  it("rejects an in-flight command on dispose", async () => {
    const [control, fake] = await connected();
    await control.setTargetPower(200);
    fake.setReplyWith(() => null);

    const pending = control.setTargetPower(210);
    await flush();
    const assertion = expect(pending).rejects.toThrow(/disposed/);
    await control.dispose();
    await assertion;
  });
});
