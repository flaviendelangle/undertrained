DROP INDEX "activities_athlete_idx";--> statement-breakpoint
UPDATE "athletes" SET "last_seen_activity_id" = coalesce((SELECT max("id") FROM "activities" WHERE "activities"."athlete" = "athletes"."id"), 0) WHERE "last_seen_activity_id" IS NULL;--> statement-breakpoint
ALTER TABLE "athletes" ALTER COLUMN "last_seen_activity_id" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "athletes" ALTER COLUMN "last_seen_activity_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "planned_trainings_linked_activity_idx" ON "planned_trainings" USING btree ("linked_activity_id") WHERE "planned_trainings"."linked_activity_id" is not null;
