import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fitBytes,
  receiptUploadId,
  uploadReceipt,
} from "~/server/lib/desktopUpload";
import { resetRateLimits } from "~/server/lib/rateLimit";

import handler from "./uploads";

const mocks = vi.hoisted(() => ({ athlete: vi.fn(), token: vi.fn() }));
vi.mock("~/server/lib/desktopSession", () => ({
  desktopAthlete: mocks.athlete,
}));
vi.mock("~/server/lib/strava", () => ({ getAccessToken: mocks.token }));
vi.mock("~/server/db", () => ({ db: {} }));
const fetchMock = vi.fn();
function response() {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn(),
    end: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}
function fit() {
  const bytes = Buffer.alloc(16);
  bytes[0] = 14;
  bytes[1] = 0x20;
  bytes.write(".FIT", 8);
  let crc = 0;
  for (const b of bytes.subarray(0, 14)) {
    crc ^= b;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  bytes.writeUInt16LE(crc, 14);
  return bytes.toString("base64");
}
async function request(
  method: string,
  body?: unknown,
  query: Record<string, unknown> = {},
) {
  const res = response();
  await handler(
    {
      method,
      body,
      query,
      headers: { authorization: "Bearer fixture" },
    } as unknown as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  vi.stubEnv("NEXTAUTH_SECRET", "fixture-secret");
  vi.stubGlobal("fetch", fetchMock);
  mocks.athlete.mockResolvedValue({ id: 7 });
  mocks.token.mockResolvedValue("upstream-private");
});
describe("desktop recording uploads", () => {
  it("requires desktop authentication before touching Strava", async () => {
    mocks.athlete.mockResolvedValue(null);
    const res = await request("POST", { name: "Ride", fitFileBase64: fit() });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.token).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects methods, bad payloads, corrupt FIT and oversized input", async () => {
    expect((await request("DELETE")).status).toHaveBeenCalledWith(405);
    for (const body of [
      { name: "", fitFileBase64: fit() },
      { name: "Ride", fitFileBase64: "not fit" },
      { name: "Ride", fitFileBase64: "A".repeat(10 * 1024 * 1024 + 1) },
    ])
      expect((await request("POST", body)).status).toHaveBeenCalledWith(400);
    const bytes = Buffer.from(fit(), "base64");
    bytes[2] = 123;
    expect(fitBytes(bytes.toString("base64"))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uploads with authenticated ownership and stable external id, never a body athlete id", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 42 }), { status: 201 }),
    );
    const res = await request("POST", {
      name: "Morning ride",
      fitFileBase64: fit(),
      athleteId: 999,
    });
    expect(mocks.token).toHaveBeenCalledWith({}, 7);
    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      { body: FormData; headers: Record<string, string> },
    ];
    expect(url).toBe("https://www.strava.com/api/v3/uploads");
    expect(options.headers.Authorization).toBe("Bearer upstream-private");
    expect(options.body.get("trainer")).toBe("1");
    expect(options.body.get("external_id")).toMatch(
      /^undertrained-7-[a-f0-9]+\.fit$/,
    );
    expect(res.status).toHaveBeenCalledWith(202);
    const result = res.json.mock.calls[0][0] as { receipt: string };
    expect(receiptUploadId(result.receipt, 7, "fixture-secret")).toBe(42);
    expect(receiptUploadId(result.receipt, 999, "fixture-secret")).toBeNull();
    expect(JSON.stringify(result)).not.toContain("upstream-private");
  });
  it("checks only receipts signed for this athlete", async () => {
    const receipt = uploadReceipt(7, 42, "fixture-secret");
    for (const value of [
      uploadReceipt(8, 42, "fixture-secret"),
      receipt + "x",
      [receipt],
      undefined,
    ])
      expect(
        (await request("GET", undefined, { receipt: value })).status,
      ).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ activity_id: 84, error: null })),
    );
    const res = await request("GET", undefined, { receipt });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://www.strava.com/api/v3/uploads/42",
    );
    expect(res.json).toHaveBeenCalledWith({ activityId: 84, error: null });
  });
  it("rejects expired receipts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01"));
    const receipt = uploadReceipt(7, 42, "fixture-secret");
    vi.setSystemTime(new Date("2026-01-09"));
    expect(receiptUploadId(receipt, 7, "fixture-secret")).toBeNull();
    vi.useRealTimers();
  });
  it("reports permissions and ambiguous submission failures without leaking credentials", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    expect(
      (await request("POST", { name: "Ride", fitFileBase64: fit() })).status,
    ).toHaveBeenCalledWith(403);
    fetchMock.mockRejectedValue(new Error("upstream-private"));
    const res = await request("POST", { name: "Ride", fitFileBase64: fit() });
    expect(res.status).toHaveBeenCalledWith(502);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(
      "upstream-private",
    );
  });
  it("bounds polling requests per athlete", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    for (let i = 0; i < 90; i++)
      await request("GET", undefined, { receipt: "bad" });
    const res = await request("GET", undefined, { receipt: "bad" });
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");
  });
});
