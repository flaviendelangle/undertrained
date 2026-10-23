import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";

import { db } from "~/server/db";
import { desktopCodes } from "~/server/db/schema";
import {
  APPROVAL_SECONDS,
  type ConsentError,
  approvalPayload,
  hash,
  nowSeconds,
  randomToken,
  validProof,
  validRedirect,
  verifyApproval,
} from "~/server/lib/desktopAuth";

import { authOptions } from "../auth/[...nextauth]";

/**
 * Undertrained Indoor opens this URL to start signing in, and the consent page
 * at /desktop/connect posts the rider's approval back to it.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'",
  );
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).end();
  const session = await getServerSession(req, res, authOptions);
  if (req.method === "GET") {
    // Sign in from here: the login page returns to this URL, not to the
    // consent page.
    if (!session)
      return res.redirect(
        302,
        `/login?callbackUrl=${encodeURIComponent(req.url!)}`,
      );
    const { search } = new URL(req.url!, "http://localhost");
    return res.redirect(302, `/desktop/connect${search}`);
  }
  // The consent page shows the error with the matching status.
  const fail = (error: ConsentError) =>
    res.redirect(303, `/desktop/connect?error=${error}`);
  const body: unknown = req.body;
  const input: Record<string, unknown> =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const { redirect_uri: redirect, state, code_challenge: challenge } = input;
  if (
    typeof redirect !== "string" ||
    !validRedirect(redirect) ||
    !validProof(state) ||
    !validProof(challenge)
  ) {
    return fail("invalid");
  }
  if (!session) {
    // Signing in again leads to a fresh consent page for the same request.
    const retry = new URLSearchParams({
      redirect_uri: redirect,
      state,
      code_challenge: challenge,
    });
    return res.redirect(
      303,
      `/login?callbackUrl=${encodeURIComponent(`/api/desktop/authorize?${retry}`)}`,
    );
  }
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return fail("unavailable");
  const expires = Number(input.expires);
  if (
    !Number.isSafeInteger(expires) ||
    expires < nowSeconds() ||
    expires > nowSeconds() + APPROVAL_SECONDS ||
    typeof input.signature !== "string" ||
    !verifyApproval(
      approvalPayload(session.athleteId, redirect, state, challenge, expires),
      input.signature,
      secret,
    )
  ) {
    return fail("expired");
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
