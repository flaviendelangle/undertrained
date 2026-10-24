// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import { act, cleanup, renderHook } from "@testing-library/react";

import type { ConnectResult } from "~/sensors/adapter";
import {
  FakeHeartRateAdapter,
  FakeTrainerAdapter,
} from "~/sensors/fakeAdapters";

import { useHeartRate, useTrainer } from "./useSensor";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

it("reports control only once the trainer is connected", async () => {
  const adapter = new FakeTrainerAdapter();
  const pending = deferred<ConnectResult>();
  adapter.result = pending.promise;
  const { result } = renderHook(() => useTrainer(adapter));

  let connecting!: Promise<void>;
  act(() => {
    connecting = result.current.connect();
  });
  // A BLE trainer probes its control point before connect() resolves.
  act(() => adapter.live.onControlAvailabilityChange(true));
  expect(result.current.state).toBe("connecting");
  expect(result.current.supportsControl).toBe(false);

  await act(async () => {
    pending.resolve({ status: "connected", deviceName: "KICKR" });
    await connecting;
  });
  expect(result.current.state).toBe("connected");
  expect(result.current.deviceName).toBe("KICKR");
  expect(result.current.supportsControl).toBe(true);
});

it.each([
  { result: { status: "cancelled" }, state: "disconnected", errorReason: null },
  {
    result: { status: "failed", reason: "unsupported-device" },
    state: "error",
    errorReason: "unsupported-device",
  },
] as const)(
  "settles a $result.status connect as $state, and retries cleanly",
  async ({ result: connectResult, state, errorReason }) => {
    const adapter = new FakeHeartRateAdapter();
    adapter.result = connectResult;
    const { result } = renderHook(() => useHeartRate(adapter));

    await act(() => result.current.connect());
    expect(result.current.state).toBe(state);
    expect(result.current.errorReason).toBe(errorReason);

    adapter.result = { status: "connected", deviceName: null };
    await act(() => result.current.connect());
    expect(result.current.state).toBe("connected");
    expect(result.current.errorReason).toBeNull();
  },
);

it("drops everything a trainer reported when it goes away on its own", async () => {
  const adapter = new FakeTrainerAdapter();
  adapter.result = { status: "connected", deviceName: "Suito" };
  const { result } = renderHook(() => useTrainer(adapter));
  await act(() => result.current.connect());
  act(() => {
    adapter.live.onControlAvailabilityChange(true);
    adapter.live.onTargetStatusChange("LowSpeed");
    adapter.live.onData({ power: 250 });
  });

  act(() => adapter.live.onDisconnect());

  expect(result.current).toMatchObject({
    state: "disconnected",
    data: null,
    deviceName: null,
    supportsControl: false,
    targetStatus: null,
  });
});

it("ignores what a connection reports once the rider has let go of it", async () => {
  const adapter = new FakeHeartRateAdapter();
  const { result } = renderHook(() => useHeartRate(adapter));
  await act(() => result.current.connect());
  const events = adapter.live;

  await act(() => result.current.disconnect());
  act(() => events.onData({ heartRate: 150 }));

  expect(result.current.state).toBe("disconnected");
  expect(result.current.data).toBeNull();
});

it("stays disconnected when the rider lets go before connect() resolves", async () => {
  const adapter = new FakeHeartRateAdapter();
  const pending = deferred<ConnectResult>();
  adapter.result = pending.promise;
  const { result } = renderHook(() => useHeartRate(adapter));

  let connecting!: Promise<void>;
  act(() => {
    connecting = result.current.connect();
  });
  await act(() => result.current.disconnect());
  await act(async () => {
    pending.resolve({ status: "connected", deviceName: null });
    await connecting;
  });

  expect(result.current.state).toBe("disconnected");
});

it("lets go of the device when the source changes, and on unmount", () => {
  const ble = new FakeTrainerAdapter();
  const ant = new FakeTrainerAdapter();
  const { rerender, unmount } = renderHook(
    ({ adapter }) => useTrainer(adapter),
    { initialProps: { adapter: ble } },
  );

  rerender({ adapter: ant });
  expect(ble.disconnect).toHaveBeenCalledOnce();
  expect(ant.disconnect).not.toHaveBeenCalled();

  unmount();
  expect(ant.disconnect).toHaveBeenCalledOnce();
});
