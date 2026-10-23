import type {
  GetServerSidePropsContext,
  NextApiRequest,
  NextApiResponse,
} from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import handler from "~/pages/api/desktop/authorize";
import { getServerSideProps } from "~/pages/desktop/connect";
import type { DesktopConnectProps } from "~/pages/desktop/connect";
import { hash, nowSeconds } from "~/server/lib/desktopAuth";

const { getServerSession, insert, values } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
}));

vi.mock("next-auth/next", () => ({ getServerSession }));
vi.mock("~/server/db", () => ({ db: { insert } }));
vi.mock("~/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));

const secret = "desktop-authorization-test-secret";
const nonce = "bm9uY2U=";
const request = {
  redirect_uri: "http://127.0.0.1:49152/callback",
  state: "s".repeat(43),
  code_challenge: hash("v".repeat(43)),
};
const search = `?${new URLSearchParams(request)}`;
const unsafeCallbacks = [
  "https://evil.example/callback",
  "http://127.0.0.1:49152/callback; form-action *",
  "http://127.0.0.1:49152/callback?next=https://evil.example",
];

function response() {
  return {
    statusCode: 200,
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
}

function header(res: ReturnType<typeof response>, name: string): unknown {
  return res.setHeader.mock.calls.filter(([key]) => key === name).at(-1)?.[1];
}

async function render(
  query: Record<string, string>,
  headers: Record<string, string> = { "x-nonce": nonce },
) {
  const res = response();
  const result = await getServerSideProps({
    req: { headers },
    res,
    query,
    resolvedUrl: `/desktop/connect?${new URLSearchParams(query)}`,
  } as unknown as GetServerSidePropsContext);
  return { res, result };
}

async function approve() {
  const { result } = await render(request);
  const { props } = result as { props: DesktopConnectProps };
  if (props.kind !== "consent") throw new Error("Expected a consent page");
  return props.approval;
}

async function invoke(
  method: string,
  input: object,
  url = "/api/desktop/authorize",
) {
  const res = response();
  await handler(
    { method, query: input, body: input, url } as NextApiRequest,
    res as unknown as NextApiResponse,
  );
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date("2026-10-23T08:00:00Z"), toFake: ["Date"] });
  vi.stubEnv("NEXTAUTH_SECRET", secret);
  getServerSession.mockResolvedValue({ athleteId: 7, user: { name: "Rider" } });
  values.mockResolvedValue(undefined);
  insert.mockReturnValue({ values });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("desktop consent page", () => {
  it("signs a five-minute approval and lets forms reach only its callback", async () => {
    const { res, result } = await render(request);
    expect(result).toEqual({
      props: {
        kind: "consent",
        name: "Rider",
        approval: {
          ...request,
          expires: nowSeconds() + 300,
          signature: expect.any(String) as unknown,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(header(res, "Content-Security-Policy")).toBe(
      "default-src 'self'; script-src 'self' 'nonce-bm9uY2U='; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self' http://127.0.0.1:49152/callback; frame-ancestors 'none'",
    );
    expect(header(res, "Cache-Control")).toBe("no-store");
    expect(header(res, "Referrer-Policy")).toBe("no-referrer");
  });

  it.each(unsafeCallbacks)(
    "rejects unsafe callbacks before adding them to CSP: %s",
    async (redirect) => {
      const { res, result } = await render({
        ...request,
        redirect_uri: redirect,
      });
      expect(res.statusCode).toBe(400);
      expect(result).toEqual({ props: { kind: "error", error: "invalid" } });
      expect(header(res, "Content-Security-Policy")).toBe(
        "default-src 'self'; script-src 'self' 'nonce-bm9uY2U='; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
    },
  );

  it("keeps a malformed nonce out of the policy", async () => {
    const { res } = await render(request, { "x-nonce": "n'; form-action *" });
    expect(header(res, "Content-Security-Policy")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self' http://127.0.0.1:49152/callback; frame-ancestors 'none'",
    );
  });

  it.each([
    ["invalid", 400],
    ["expired", 403],
    ["unavailable", 503],
  ])(
    "shows the %s error from the approval route with status %i",
    async (error, status) => {
      const { res, result } = await render({ error });
      expect(res.statusCode).toBe(status);
      expect(result).toEqual({ props: { kind: "error", error } });
    },
  );

  it("sends a signed-out rider to sign in through the desktop entry point", async () => {
    getServerSession.mockResolvedValue(null);
    const { result } = await render(request);
    expect(result).toEqual({
      redirect: {
        destination: `/login?callbackUrl=${encodeURIComponent(`/api/desktop/authorize${search}`)}`,
        permanent: false,
      },
    });
  });
});

describe("desktop authorization route", () => {
  it("sends shipped desktop builds to the consent page, signing in first", async () => {
    const url = `/api/desktop/authorize${search}`;
    const signedIn = await invoke("GET", request, url);
    expect(signedIn.redirect).toHaveBeenCalledWith(
      302,
      `/desktop/connect${search}`,
    );
    getServerSession.mockResolvedValue(null);
    const signedOut = await invoke("GET", request, url);
    expect(signedOut.redirect).toHaveBeenCalledWith(
      302,
      `/login?callbackUrl=${encodeURIComponent(url)}`,
    );
  });

  it.each(unsafeCallbacks)(
    "rejects unsafe callbacks in an approval: %s",
    async (redirect) => {
      const res = await invoke("POST", {
        ...(await approve()),
        redirect_uri: redirect,
      });
      expect(res.redirect).toHaveBeenCalledWith(
        303,
        "/desktop/connect?error=invalid",
      );
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("accepts only the approval the consent page signed for this account", async () => {
    const approval = await approve();
    const tampered = await invoke("POST", {
      ...approval,
      redirect_uri: "http://127.0.0.1:49153/callback",
    });
    expect(tampered.redirect).toHaveBeenCalledWith(
      303,
      "/desktop/connect?error=expired",
    );
    getServerSession.mockResolvedValue({
      athleteId: 8,
      user: { name: "Other" },
    });
    const switched = await invoke("POST", approval);
    expect(switched.redirect).toHaveBeenCalledWith(
      303,
      "/desktop/connect?error=expired",
    );
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
    const [[, location]] = valid.redirect.mock.calls as [[number, string]];
    const code = new URL(location).searchParams.get("code")!;
    expect(values).toHaveBeenCalledExactlyOnceWith({
      codeHash: hash(code),
      athlete: 7,
      challenge: request.code_challenge,
      expiresAt: nowSeconds() + 60,
    });
  });

  it("sends a rider whose session ended to sign in, then back to consent", async () => {
    const approval = await approve();
    getServerSession.mockResolvedValue(null);
    const res = await invoke("POST", approval);
    expect(res.redirect).toHaveBeenCalledWith(
      303,
      `/login?callbackUrl=${encodeURIComponent(`/api/desktop/authorize${search}`)}`,
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
