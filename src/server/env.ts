import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  STRAVA_CLIENT_ID: z.string().min(1, "STRAVA_CLIENT_ID is required"),
  STRAVA_CLIENT_SECRET: z.string().min(1, "STRAVA_CLIENT_SECRET is required"),
  STRAVA_WEBHOOK_VERIFY_TOKEN: z
    .string()
    .min(1, "STRAVA_WEBHOOK_VERIFY_TOKEN is required"),
  STRAVA_WEBHOOK_CALLBACK_URL: z.string().url().optional(),
  // Public origin of the app (e.g. https://undertrained.app), used to build the
  // absolute iCal subscription URL shown to athletes. Falls back to the request
  // origin when unset.
  APP_URL: z.string().url().optional(),
  // IANA timezone the planned-training iCal feed anchors event times to. Stored
  // plan times are floating wall-clock (no offset); the feed converts them to
  // absolute UTC instants in this zone so subscribed calendars (Google included,
  // which treats floating times as UTC) show them at the intended local time.
  CALENDAR_TIMEZONE: z
    .string()
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      "CALENDAR_TIMEZONE must be a valid IANA timezone (e.g. Europe/Paris)",
    )
    .default("Europe/Paris"),
});

export const env = envSchema.parse(process.env);
