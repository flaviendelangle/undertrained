import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export const randomToken = () => randomBytes(32).toString("base64url");
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function validRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      Number(url.port) >= 1024 &&
      Number(url.port) <= 65535 &&
      url.pathname === "/callback" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function validProof(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function signApproval(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** How long the consent page's approval stays valid. */
export const APPROVAL_SECONDS = 300;

/** What a consent approval is bound to: the account, the request and its expiry. */
export function approvalPayload(
  athlete: number,
  redirect: string,
  state: string,
  challenge: string,
  expires: number,
): string {
  return JSON.stringify([athlete, redirect, state, challenge, expires]);
}

export function verifyApproval(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(signApproval(payload, secret));
  const received = Buffer.from(signature);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

/** Why the consent page cannot ask for approval, and the status it answers with. */
export const CONSENT_ERROR_STATUS = {
  invalid: 400,
  expired: 403,
  unavailable: 503,
} as const;

export type ConsentError = keyof typeof CONSENT_ERROR_STATUS;

export function isConsentError(value: unknown): value is ConsentError {
  return (
    typeof value === "string" && Object.hasOwn(CONSENT_ERROR_STATUS, value)
  );
}
