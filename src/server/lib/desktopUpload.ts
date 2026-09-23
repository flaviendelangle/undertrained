import { z } from "zod";

import { nowSeconds, signApproval, verifyApproval } from "./desktopAuth";

export const uploadBody = z.object({
  name: z.string().trim().min(1).max(200),
  fitFileBase64: z
    .string()
    .min(20)
    .max(10 * 1024 * 1024),
});

/** A status receipt binds the upstream upload to its authenticated owner. */
export function uploadReceipt(
  athleteId: number,
  uploadId: number,
  secret: string,
) {
  const payload = `recording:${athleteId}:${uploadId}:${nowSeconds() + 7 * 86400}`;
  return `${payload}.${signApproval(payload, secret)}`;
}

export function receiptUploadId(
  receipt: unknown,
  athleteId: number,
  secret: string,
): number | null {
  if (typeof receipt !== "string" || receipt.length > 250) return null;
  const match = /^(recording:(\d+):(\d+):(\d+))\.([A-Za-z0-9_-]{43})$/.exec(
    receipt,
  );
  if (!match || !verifyApproval(match[1], match[5], secret)) return null;
  const id = Number(match[3]);
  if (
    Number(match[2]) !== athleteId ||
    Number(match[4]) <= nowSeconds() ||
    !Number.isSafeInteger(id) ||
    id <= 0
  )
    return null;
  return id;
}

export function fitBytes(base64: string): Buffer | null {
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) return null;
  if (
    bytes.length < 14 ||
    ![12, 14].includes(bytes[0]) ||
    bytes.toString("ascii", 8, 12) !== ".FIT"
  )
    return null;
  if (bytes.readUInt32LE(4) + bytes[0] + 2 !== bytes.length) return null;
  // FIT's CRC-16 covers the header and data, followed by the checksum itself.
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc === 0 ? bytes : null;
}
