CREATE TABLE "calendar_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"name" text NOT NULL,
	"ical_url" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"last_fetched_at" bigint,
	"last_error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_subscriptions" ADD CONSTRAINT "calendar_subscriptions_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_subscriptions_athlete_idx" ON "calendar_subscriptions" USING btree ("athlete");