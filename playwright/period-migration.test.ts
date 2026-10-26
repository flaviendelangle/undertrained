import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

import { expect, test } from "@playwright/test";

import {
  DEFAULT_ACTIVITY_DISPLAY,
  EMPTY_ACTIVITY_FILTER,
  activityDisplaySchema,
  activityRulesSchema,
} from "../src/utils/activityFilters";

for (const populated of [true, false]) {
  test(`period migration preserves legacy definitions and resets IDs (${populated ? "existing periods" : "empty database"})`, async () => {
    const databaseUrl = process.env.DATABASE_URL!;
    const admin = postgres(databaseUrl, { max: 1 });
    const databaseName = `period_migration_${randomUUID().replaceAll("-", "")}`;
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    const db = postgres(isolatedUrl.toString(), { max: 1 });
    try {
      await admin`CREATE DATABASE ${admin(databaseName)}`;
      await db.unsafe(`
        CREATE TABLE athletes (id integer PRIMARY KEY);
        INSERT INTO athletes VALUES (1), (2);
        CREATE TABLE time_periods (
          id integer PRIMARY KEY, athlete integer, name text,
          start_date text, end_date text, sport_types jsonb
        );
      `);
      if (populated) {
        await db.unsafe(`
          INSERT INTO time_periods VALUES
            (3, 1, 'Alps holiday', '2025-07-01', '2025-07-14', '["Ride","Hike"]'),
            (7, 1, 'Marathon prep', '2026-01-01', '2026-04-12', NULL),
            (9, 2, 'Other athlete', '2024-12-30', '2024-12-31', '[]');
        `);
      }
      const migration = await readFile(
        "src/server/db/migrations/0027_melodic_preak.sql",
        "utf8",
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) await db.unsafe(statement);
      }
      const migrated = await db`
        SELECT id, athlete, name, folder_id, rules, display FROM activity_views ORDER BY id
      `;
      expect(migrated.map((row) => [row.id, row.athlete, row.name])).toEqual(
        populated
          ? [
              [3, 1, "Alps holiday"],
              [7, 1, "Marathon prep"],
              [9, 2, "Other athlete"],
            ]
          : [],
      );
      const periods = await db`SELECT * FROM time_periods ORDER BY id`;
      for (const [index, row] of migrated.entries()) {
        const period = periods[index];
        expect(row.folder_id).toBeNull();
        expect(activityDisplaySchema.parse(row.display)).toEqual(
          DEFAULT_ACTIVITY_DISPLAY,
        );
        const rules = activityRulesSchema.parse(row.rules);
        expect(rules.join).toBe("AND");
        expect(rules.children).toEqual([
          expect.objectContaining({
            kind: "condition",
            field: "date",
            operator: "between",
            value: period.start_date,
            valueTo: period.end_date,
          }),
          ...(index === 0
            ? [
                expect.objectContaining({
                  kind: "condition",
                  field: "sport",
                  operator: "in",
                  values: ["Ride", "Hike"],
                }),
              ]
            : []),
        ]);
      }
      const [created] = await db`
        INSERT INTO activity_views (athlete, name, rules, display)
        VALUES (1, 'Next view', ${JSON.stringify(EMPTY_ACTIVITY_FILTER)}::jsonb, ${JSON.stringify(DEFAULT_ACTIVITY_DISPLAY)}::jsonb)
        RETURNING id
      `;
      expect(created.id).toBe(populated ? 10 : 1);
    } finally {
      await db.end();
      await admin`DROP DATABASE IF EXISTS ${admin(databaseName)}`;
      await admin.end();
    }
  });
}
