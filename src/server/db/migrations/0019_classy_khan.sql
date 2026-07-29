CREATE TABLE "structured_workouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sport" text DEFAULT 'bike' NOT NULL,
	"structure" jsonb NOT NULL,
	"duration_seconds" integer NOT NULL,
	"estimated_tss" real,
	"ftp_at_save" integer,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "planned_trainings" ADD COLUMN "structured_workout_id" integer;--> statement-breakpoint
ALTER TABLE "structured_workouts" ADD CONSTRAINT "structured_workouts_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structured_workouts_athlete_idx" ON "structured_workouts" USING btree ("athlete");--> statement-breakpoint
CREATE INDEX "structured_workouts_athlete_updated_idx" ON "structured_workouts" USING btree ("athlete","updated_at");--> statement-breakpoint
ALTER TABLE "planned_trainings" ADD CONSTRAINT "planned_trainings_structured_workout_id_structured_workouts_id_fk" FOREIGN KEY ("structured_workout_id") REFERENCES "public"."structured_workouts"("id") ON DELETE set null ON UPDATE no action;