CREATE TABLE "routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"name" text NOT NULL,
	"sport" text NOT NULL,
	"profile" text NOT NULL,
	"waypoints" jsonb NOT NULL,
	"map_polyline" text NOT NULL,
	"distance" real NOT NULL,
	"elevation_gain" real,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routes_athlete_idx" ON "routes" USING btree ("athlete");--> statement-breakpoint
CREATE INDEX "routes_athlete_created_idx" ON "routes" USING btree ("athlete","created_at");