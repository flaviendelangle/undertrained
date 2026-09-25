import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "~/pages/api/desktop/authorize";
import { hash, nowSeconds, signApproval } from "~/server/lib/desktopAuth";

const { getServerSession, insert } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("next-auth/next", () => ({ getServerSession }));
vi.mock("~/server/db", () => ({ db: { insert } }));
vi.mock("~/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const secret = "desktop-authorization-test-secret";
const request = {
  redirect_uri: "http://127.0.0.1:49152/callback",
  state: "s".repeat(43),
  code_challenge: hash("v".repeat(43)),
};

async function invoke(method: string, input: Record<string, unknown>) {
  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
  await handler(
    { method, query: input, body: input } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", secret);
  getServerSession.mockResolvedValue({ athleteId: 7, user: { name: "Rider" } });
  insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
});

afterEach(() => vi.unstubAllEnvs());

describe("desktop consent", () => {
  it("allows the exact callback in the consent page's form-action policy", async () => {
    const res = await invoke("GET", request);
    const policy: unknown = res.setHeader.mock.calls
      .filter(([name]) => name === "Content-Security-Policy")
      .at(-1)?.[1];
    expect(policy).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://127.0.0.1:49152/callback; frame-ancestors 'none'",
    );
    expect(res.send).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example/callback",
    "http://127.0.0.1:49152/callback; form-action *",
    "http://127.0.0.1:49152/callback?next=https://evil.example",
  ])(
    "rejects unsafe callbacks before adding them to CSP: %s",
    async (redirect) => {
      const res = await invoke("GET", { ...request, redirect_uri: redirect });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      );
      expect(res.send).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("keeps approval bound to the callback and account", async () => {
    const expires = nowSeconds() + 300;
    const signature = signApproval(
      JSON.stringify([
        7,
        request.redirect_uri,
        request.state,
        request.code_challenge,
        expires,
      ]),
      secret,
    );
    const approval = { ...request, expires, signature };
    const tampered = await invoke("POST", {
      ...approval,
      redirect_uri: "http://127.0.0.1:49153/callback",
    });
    expect(tampered.status).toHaveBeenCalledWith(403);
    getServerSession.mockResolvedValue({
      athleteId: 8,
      user: { name: "Other" },
    });
    const switched = await invoke("POST", approval);
    expect(switched.status).toHaveBeenCalledWith(403);
    expect(insert).not.toHaveBeenCalled();

    getServerSession.mockResolvedValue({
      athleteId: 7,
      user: { name: "Rider" },
    });
    const valid = await invoke("POST", approval);
    expect(valid.redirect).toHaveBeenCalledWith(
      303,
      expect.stringMatching(
        /^http:\/\/127\.0\.0\.1:49152\/callback\?code=[A-Za-z0-9_-]{43}&state=s{43}$/,
      ),
    );
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
