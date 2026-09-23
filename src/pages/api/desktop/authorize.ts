import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";

import { db } from "~/server/db";
import { desktopCodes } from "~/server/db/schema";
import {
  escapeHtml,
  hash,
  nowSeconds,
  randomToken,
  signApproval,
  validProof,
  validRedirect,
  verifyApproval,
} from "~/server/lib/desktopAuth";

import { authOptions } from "../auth/[...nextauth]";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  );
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).end();
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    if (req.method !== "GET")
      return res.status(401).json({ error: "Sign in again" });
    return res.redirect(
      302,
      `/login?callbackUrl=${encodeURIComponent(req.url!)}`,
    );
  }
  const body: unknown = req.body;
  const input: Record<string, unknown> =
    req.method === "GET"
      ? req.query
      : body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};
  const { redirect_uri: redirect, state, code_challenge: challenge } = input;
  if (
    typeof redirect !== "string" ||
    !validRedirect(redirect) ||
    !validProof(state) ||
    !validProof(challenge)
  ) {
    return res
      .status(400)
      .json({ error: "Invalid desktop authorization request" });
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret)
    return res.status(503).json({ error: "Desktop sign-in is not configured" });
  // Chrome checks form-action on the POST's redirect as well as its target.
  // Serialize the validated URL so raw input cannot add CSP directives.
  const callback = new URL(redirect);
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callback.origin}${callback.pathname}; frame-ancestors 'none'`,
  );
  if (req.method === "GET") {
    const expires = nowSeconds() + 300;
    const payload = JSON.stringify([
      session.athleteId,
      redirect,
      state,
      challenge,
      expires,
    ]);
    const signature = signApproval(payload, secret);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Undertrained Indoor</title><style>body{background:#111513;color:#f2f4e9;font:16px system-ui;display:grid;place-items:center;min-height:95vh}main{max-width:420px;padding:40px;background:#1b211e;border-radius:16px}p{color:#a2afa5;line-height:1.6}button{background:#d5f780;color:#182014;padding:16px 22px;border:0;border-radius:8px;font-weight:700;font-size:16px;cursor:pointer}</style><main><p>UNDERTRAINED INDOOR</p><h1>Connect your desktop app</h1><p>Continue as ${escapeHtml(session.user?.name ?? "your Undertrained account")}. Only approve this if you just started signing in from Undertrained Indoor on this computer.</p><form method="post"><input type="hidden" name="redirect_uri" value="${escapeHtml(redirect)}"><input type="hidden" name="state" value="${state}"><input type="hidden" name="code_challenge" value="${challenge}"><input type="hidden" name="expires" value="${expires}"><input type="hidden" name="signature" value="${signature}"><button>Connect Undertrained Indoor</button></form><p>You can close this page to cancel.</p></main></html>`,
    );
  }
  const expires = Number(input.expires);
  const payload = JSON.stringify([
    session.athleteId,
    redirect,
    state,
    challenge,
    expires,
  ]);
  if (
    !Number.isSafeInteger(expires) ||
    expires < nowSeconds() ||
    expires > nowSeconds() + 300 ||
    typeof input.signature !== "string" ||
    !verifyApproval(payload, input.signature, secret)
  ) {
    return res
      .status(403)
      .json({ error: "Approval expired. Start sign-in again." });
  }
  const code = randomToken();
  await db.insert(desktopCodes).values({
    codeHash: hash(code),
    athlete: session.athleteId,
    challenge,
    expiresAt: nowSeconds() + 60,
  });
  const target = new URL(redirect);
  target.searchParams.set("code", code);
  target.searchParams.set("state", state);
  return res.redirect(303, target.toString());
}
