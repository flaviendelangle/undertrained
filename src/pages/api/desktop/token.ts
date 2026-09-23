import { and, eq, gt } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "~/server/db";
import { athletes, desktopCodes, desktopSessions } from "~/server/db/schema";
import {
  hash,
  nowSeconds,
  randomToken,
  validProof,
} from "~/server/lib/desktopAuth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const body: unknown = req.body;
  const { code, code_verifier: verifier } =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!validProof(code) || !validProof(verifier))
    return res.status(400).json({ error: "Invalid authorization code" });
  const result = await db.transaction(async (tx) => {
    // Atomic consumption prevents two requests exchanging the same code.
    const [grant] = await tx
      .delete(desktopCodes)
      .where(
        and(
          eq(desktopCodes.codeHash, hash(code)),
          eq(desktopCodes.challenge, hash(verifier)),
          gt(desktopCodes.expiresAt, nowSeconds()),
        ),
      )
      .returning();
    if (!grant) return null;
    const [athlete] = await tx
      .select({
        id: athletes.id,
        name: athletes.name,
        language: athletes.language,
      })
      .from(athletes)
      .where(eq(athletes.id, grant.athlete));
    if (!athlete) return null;
    const token = randomToken();
    const expires = nowSeconds() + 30 * 24 * 60 * 60;
    await tx.insert(desktopSessions).values({
      tokenHash: hash(token),
      athlete: athlete.id,
      expiresAt: expires,
    });
    return {
      access_token: token,
      expires_at: expires,
      athlete: {
        id: athlete.id,
        name: athlete.name ?? "Rider",
        language: athlete.language,
      },
    };
  });
  return result
    ? res.json(result)
    : res
        .status(401)
        .json({ error: "Authorization code expired or already used" });
}
