CREATE TABLE "activity_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"folder_id" integer,
	"name" text NOT NULL,
	"rules" jsonb NOT NULL,
	"display" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"athlete" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_views" ADD CONSTRAINT "activity_views_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_views" ADD CONSTRAINT "activity_views_folder_id_view_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."view_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_folders" ADD CONSTRAINT "view_folders_athlete_athletes_id_fk" FOREIGN KEY ("athlete") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_views_athlete_idx" ON "activity_views" USING btree ("athlete");--> statement-breakpoint
CREATE INDEX "view_folders_athlete_idx" ON "view_folders" USING btree ("athlete");
--> statement-breakpoint
-- Preserve period IDs so existing /time-periods/:id links can redirect to views.
INSERT INTO activity_views (id, athlete, name, rules, display)
SELECT id, athlete, name,
  jsonb_build_object('kind', 'group', 'id', 'root', 'join', 'AND', 'children',
    jsonb_build_array(jsonb_build_object('kind', 'condition', 'id', 'period-dates',
      'field', 'date', 'operator', 'between', 'value', start_date, 'valueTo', end_date, 'values', '[]'::jsonb))
    || CASE WHEN sport_types IS NOT NULL AND jsonb_array_length(sport_types) > 0
      THEN jsonb_build_array(jsonb_build_object('kind', 'condition', 'id', 'period-sports',
        'field', 'sport', 'operator', 'in', 'value', '', 'valueTo', '', 'values', sport_types))
      ELSE '[]'::jsonb END),
  '{"columns":["type","name","startDateLocal","distance","totalElevationGain","movingTime","averageSpeed","load"],"sort":{"id":"startDateLocal","desc":true},"groupBy":"none"}'::jsonb
FROM time_periods;
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('activity_views', 'id'), COALESCE((SELECT MAX(id) FROM activity_views), 1), EXISTS(SELECT 1 FROM activity_views));
