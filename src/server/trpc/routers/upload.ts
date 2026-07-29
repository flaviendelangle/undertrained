import { z } from "zod";

import { getAccessToken } from "../../lib/strava";
import {
  protectedProcedure,
  rateLimited,
  router,
  validateAthleteOwnership,
} from "../index";

export const uploadRouter = router({
  uploadToStrava: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        fitFileBase64: z
          .string()
          .max(10 * 1024 * 1024, "File too large (max 10 MB)"),
        name: z.string(),
        description: z.string().optional(),
      }),
    )
    .use(validateAthleteOwnership)
    .use(rateLimited)
    .mutation(async ({ ctx, input }) => {
      const accessToken = await getAccessToken(ctx.db, input.athleteId);

      const fitBuffer = Buffer.from(input.fitFileBase64, "base64");

      // Validate FIT file header: byte 8-11 must be ".FIT"
      if (
        fitBuffer.length < 12 ||
        fitBuffer.toString("ascii", 8, 12) !== ".FIT"
      ) {
        throw new Error("Invalid FIT file format");
      }

      const formData = new FormData();
      formData.append(
        "file",
        new Blob([fitBuffer], { type: "application/octet-stream" }),
        "training.fit",
      );
      formData.append("data_type", "fit");
      formData.append("trainer", "1");
      formData.append("name", input.name);
      if (input.description) {
        formData.append("description", input.description);
      }

      const response = await fetch("https://www.strava.com/api/v3/uploads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        throw new Error(`Strava upload failed with status ${response.status}`);
      }

      const result = z
        .object({ id: z.number(), status: z.string() })
        .parse(await response.json());
      return {
        uploadId: result.id,
        status: result.status,
      };
    }),

  checkUploadStatus: protectedProcedure
    .input(
      z.object({
        athleteId: z.number(),
        uploadId: z.number(),
      }),
    )
    .use(validateAthleteOwnership)
    .mutation(async ({ ctx, input }) => {
      const accessToken = await getAccessToken(ctx.db, input.athleteId);

      const response = await fetch(
        `https://www.strava.com/api/v3/uploads/${input.uploadId}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }

      const result = z
        .object({
          status: z.string(),
          activity_id: z.number().nullable(),
          error: z.string().nullable(),
        })
        .parse(await response.json());
      return {
        status: result.status,
        activityId: result.activity_id,
        error: result.error,
      };
    }),
});
