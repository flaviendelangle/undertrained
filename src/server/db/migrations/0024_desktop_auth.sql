CREATE TABLE "desktop_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"challenge" text NOT NULL,
	"expires_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"expires_at" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "desktop_codes" ADD CONSTRAINT "desktop_codes_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_sessions" ADD CONSTRAINT "desktop_sessions_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;