import { eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";

import { db } from "~/server/db";
import { desktopSessions } from "~/server/db/schema";
import { hash, validProof } from "~/server/lib/desktopAuth";
import { desktopAthlete } from "~/server/lib/desktopSession";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "DELETE")
    return res.status(405).end();
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  if (!validProof(token)) return res.status(401).end();
  if (req.method === "DELETE") {
    await db
      .delete(desktopSessions)
      .where(eq(desktopSessions.tokenHash, hash(token)));
    return res.status(204).end();
  }
  const athlete = await desktopAthlete(req.headers.authorization);
  return athlete ? res.json({ athlete }) : res.status(401).end();
}
