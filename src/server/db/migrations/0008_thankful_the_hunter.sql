CREATE TABLE "athlete_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "best_efforts" (
	"id" serial PRIMARY KEY NOT NULL,
	"activity_id" integer NOT NULL,
	"strava_effort_id" bigint,
	"name" text NOT NULL,
	"distance" real NOT NULL,
	"elapsed_time" integer NOT NULL,
	"moving_time" integer,
	"pr_rank" integer,
	"start_date" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "are_best_efforts_loaded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "best_effort_fetch_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "athlete_stats" ADD CONSTRAINT "athlete_stats_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "best_efforts" ADD CONSTRAINT "best_efforts_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athlete_stats_athlete_idx" ON "athlete_stats" USING btree ("athlete");--> statement-breakpoint
CREATE INDEX "best_efforts_activity_id_idx" ON "best_efforts" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "best_efforts_activity_id_name_idx" ON "best_efforts" USING btree ("activity_id","name");--> statement-breakpoint
CREATE INDEX "activities_athlete_best_efforts_idx" ON "activities" USING btree ("athlete","are_best_efforts_loaded");