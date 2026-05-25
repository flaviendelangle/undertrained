CREATE TYPE "public"."planned_training_status" AS ENUM('planned', 'completed');--> statement-breakpoint
CREATE TABLE "planned_trainings" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"title" text NOT NULL,
	"planned_date" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"sport_type" text NOT NULL,
	"status" "planned_training_status" DEFAULT 'planned' NOT NULL,
	"linked_activity_id" integer,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "calendar_token" text;--> statement-breakpoint
ALTER TABLE "planned_trainings" ADD CONSTRAINT "planned_trainings_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_trainings" ADD CONSTRAINT "planned_trainings_linked_activity_id_activities_id_fk" FOREIGN KEY ("linked_activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_trainings_athlete_idx" ON "planned_trainings" USING btree ("athlete");--> statement-breakpoint
CREATE INDEX "planned_trainings_athlete_date_idx" ON "planned_trainings" USING btree ("athlete","planned_date");--> statement-breakpoint
CREATE UNIQUE INDEX "athletes_calendar_token_idx" ON "athletes" USING btree ("calendar_token");