import { and, eq, gt } from "drizzle-orm";

import { db } from "../db";
import { athletes, desktopSessions } from "../db/schema";
import { hash, nowSeconds, validProof } from "./desktopAuth";

export async function desktopAthlete(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  if (!validProof(token)) return null;
  const [athlete] = await db
    .select({
      id: athletes.id,
      name: athletes.name,
      language: athletes.language,
    })
    .from(desktopSessions)
    .innerJoin(athletes, eq(athletes.id, desktopSessions.athlete))
    .where(
      and(
        eq(desktopSessions.tokenHash, hash(token)),
        gt(desktopSessions.expiresAt, nowSeconds()),
      ),
    );
  return athlete ? { ...athlete, name: athlete.name ?? "Rider" } : null;
}
