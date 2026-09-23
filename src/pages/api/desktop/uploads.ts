import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "node:crypto";
import { z } from "zod";

import { TRPCError } from "@trpc/server";

import { db } from "~/server/db";
import { desktopAthlete } from "~/server/lib/desktopSession";
import {
  fitBytes,
  receiptUploadId,
  uploadBody,
  uploadReceipt,
} from "~/server/lib/desktopUpload";
import { consumeRateLimit } from "~/server/lib/rateLimit";
import { getAccessToken } from "~/server/lib/strava";

export const config = { api: { bodyParser: { sizeLimit: "11mb" } } };

const reconnectError =
  "Strava authorization is missing or expired. Reconnect Strava on the website and allow activity uploads.";

/** Uses the same Strava upload flow as the website, authenticated by desktop bearer. */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Allow", "POST, GET");
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).end();
  const athlete = await desktopAthlete(req.headers.authorization);
  if (!athlete) return res.status(401).end();
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret)
    return res.status(503).json({ error: "Upload service unavailable" });
  const submit = req.method === "POST";
  if (
    !consumeRateLimit(
      `desktop-upload:${submit ? "submit" : "poll"}:${athlete.id}`,
      submit ? 10 : 90,
      60_000,
    )
  ) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Please wait before trying again" });
  }
  const body = submit ? uploadBody.safeParse(req.body) : null;
  const bytes = body?.success ? fitBytes(body.data.fitFileBase64) : null;
  const uploadId = submit
    ? null
    : receiptUploadId(req.query.receipt, athlete.id, secret);
  if (submit ? !body?.success || !bytes : uploadId === null)
    return res.status(400).json({ error: "Invalid upload request" });
  try {
    const accessToken = await getAccessToken(db, athlete.id);
    if (submit && body?.success && bytes) {
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }),
        "ride.fit",
      );
      form.append("data_type", "fit");
      form.append("trainer", "1");
      form.append("name", body.data.name);
      // Stable identity helps upstream duplicate detection after an uncertain response.
      const digest = createHash("sha256").update(bytes).digest("hex");
      form.append("external_id", `undertrained-${athlete.id}-${digest}.fit`);
      const response = await fetch("https://www.strava.com/api/v3/uploads", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status === 401 || response.status === 403)
        return res.status(403).json({ error: reconnectError });
      if (!response.ok)
        return res.status(502).json({
          error:
            "Strava could not accept this upload. Check Strava before retrying.",
        });
      const result = z
        .object({ id: z.number().int().positive().safe() })
        .parse(await response.json());
      return res.status(202).json({
        uploadId: result.id,
        receipt: uploadReceipt(athlete.id, result.id, secret),
      });
    }
    const response = await fetch(
      `https://www.strava.com/api/v3/uploads/${uploadId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 401 || response.status === 403)
      return res.status(403).json({ error: reconnectError });
    if (!response.ok)
      return res
        .status(502)
        .json({ error: "Could not check the Strava upload" });
    const status = z
      .object({
        activity_id: z.number().int().positive().safe().nullable(),
        error: z.string().nullable(),
      })
      .parse(await response.json());
    return res.json({ activityId: status.activity_id, error: status.error });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "UNAUTHORIZED")
      return res.status(403).json({ error: reconnectError });
    // Do not leak upstream credentials or internals; submission timeouts may have succeeded.
    return res.status(502).json({
      error: submit
        ? "Upload response unavailable. Check Strava before retrying."
        : "Could not check the Strava upload",
    });
  }
}
