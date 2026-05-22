ALTER TABLE "activities" ADD COLUMN "commute" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "perceived_exertion" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "private_note" text;--> statement-breakpoint
-- Backfill: the detail fetch now stores description/RPE/private note (and laps)
-- for every activity, not just best efforts for runs. Reset the loaded flag so
-- the next sync re-fetches each activity's detail once and populates the new
-- columns. (Column name predates the runs-only→all-activities generalization.)
UPDATE "activities" SET "are_best_efforts_loaded" = false;