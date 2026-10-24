import {
  DEFAULT_RIDER_SETTINGS_TIMELINE,
  type RiderSettingsChangePoint,
  type RiderSettingsTimeline,
  type TimeVaryingField,
} from "~/sensors/types";

import { TIME_VARYING_FIELDS } from "./fieldConfig";

const DEFAULTS = DEFAULT_RIDER_SETTINGS_TIMELINE.initialValues;

function sortChanges(
  changes: RiderSettingsChangePoint[],
): RiderSettingsChangePoint[] {
  return [...changes].sort((a, b) => a.date.localeCompare(b.date));
}

function hasAnyField(point: RiderSettingsChangePoint): boolean {
  return TIME_VARYING_FIELDS.some((f) => point[f] !== undefined);
}

/**
 * Set a single time-varying field on the change point at `date`.
 * - `value === null` removes that field (and drops the point if it becomes empty),
 * - creating the point on that date if none exists.
 */
export function setField(
  timeline: RiderSettingsTimeline,
  field: TimeVaryingField,
  date: string,
  value: number | null,
): RiderSettingsTimeline {
  const idx = timeline.changes.findIndex((c) => c.date === date);

  if (idx >= 0) {
    const updated = { ...timeline.changes[idx] };
    if (value == null) {
      delete updated[field];
    } else {
      updated[field] = value;
    }
    const newChanges = [...timeline.changes];
    if (hasAnyField(updated)) {
      newChanges[idx] = updated;
    } else {
      newChanges.splice(idx, 1);
    }
    return { ...timeline, changes: sortChanges(newChanges) };
  }

  if (value == null) return timeline;
  return {
    ...timeline,
    changes: sortChanges([
      ...timeline.changes,
      { id: crypto.randomUUID(), date, [field]: value },
    ]),
  };
}

/** Remove a single field from the change point at `date` (reverts to inherited). */
export function deleteField(
  timeline: RiderSettingsTimeline,
  field: TimeVaryingField,
  date: string,
): RiderSettingsTimeline {
  return setField(timeline, field, date, null);
}

/** Write a single field into the baseline (initial) values. */
export function setBaselineField(
  timeline: RiderSettingsTimeline,
  field: TimeVaryingField,
  value: number | null,
): RiderSettingsTimeline {
  return {
    ...timeline,
    initialValues: { ...timeline.initialValues, [field]: value },
  };
}

export interface FieldHistoryEntry {
  /** Change-point id, or undefined for the baseline row. */
  id?: string;
  /** "YYYY-MM-DD", or null for the baseline ("Start"). */
  date: string | null;
  /** Explicit value at this entry (null when the baseline is unset). */
  value: number | null;
  isBaseline: boolean;
}

/**
 * The explicit history of one field: the baseline first, then each change that
 * touches the field, ascending by date. Skips changes that don't set the field.
 */
export function getFieldHistory(
  timeline: RiderSettingsTimeline,
  field: TimeVaryingField,
): FieldHistoryEntry[] {
  const entries: FieldHistoryEntry[] = [
    {
      date: null,
      value: timeline.initialValues[field],
      isBaseline: true,
    },
  ];
  for (const change of timeline.changes) {
    if (change[field] !== undefined) {
      entries.push({
        id: change.id,
        date: change.date,
        value: change[field],
        isBaseline: false,
      });
    }
  }
  return entries;
}

/** Resolve the current (latest) explicit value of a field, falling back to defaults. */
export function currentFieldValue(
  timeline: RiderSettingsTimeline,
  field: TimeVaryingField,
): number {
  const history = getFieldHistory(timeline, field);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].value != null) return history[i].value!;
  }
  return DEFAULTS[field]!;
}

/** The baseline ("Start") value of a field, falling back to defaults. */
export function startFieldValue(
  timeline: RiderSettingsTimeline,
  field: TimeVaryingField,
): number {
  return timeline.initialValues[field] ?? DEFAULTS[field]!;
}
