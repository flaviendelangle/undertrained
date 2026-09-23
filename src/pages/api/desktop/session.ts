import { and, eq, gt } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "~/server/db";
import { athletes, desktopSessions } from "~/server/db/schema";
import { hash, nowSeconds, validProof } from "~/server/lib/desktopAuth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "DELETE")
    return res.status(405).end();
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!validProof(token)) return res.status(401).end();
  if (req.method === "DELETE") {
    await db
      .delete(desktopSessions)
      .where(eq(desktopSessions.tokenHash, hash(token)));
    return res.status(204).end();
  }
  const [session] = await db
    .select({ id: athletes.id, name: athletes.name })
    .from(desktopSessions)
    .innerJoin(athletes, eq(athletes.id, desktopSessions.athlete))
    .where(
      and(
        eq(desktopSessions.tokenHash, hash(token)),
        gt(desktopSessions.expiresAt, nowSeconds()),
      ),
    );
  return session
    ? res.json({ athlete: { ...session, name: session.name ?? "Rider" } })
    : res.status(401).end();
}
