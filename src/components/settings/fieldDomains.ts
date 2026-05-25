import type { TimeVaryingField } from "~/sensors/types";

import { RIDER_FIELD_CONFIG, type RiderFieldConfig } from "./fieldConfig";

export interface FieldDomain {
  id: string;
  label: string;
  fields: RiderFieldConfig[];
}

function byField(field: TimeVaryingField): RiderFieldConfig {
  const config = RIDER_FIELD_CONFIG.find((c) => c.field === field);
  if (!config) throw new Error(`No field config for ${field}`);
  return config;
}

/**
 * Groups the time-varying fields by athletic domain. Used to lay out the
 * metric cards (Proposal A) and the metric tabs of the timeline editor
 * (Proposal B).
 */
export const FIELD_DOMAINS: FieldDomain[] = [
  { id: "cycling", label: "Cycling", fields: [byField("ftp")] },
  { id: "body", label: "Body", fields: [byField("weightKg")] },
  {
    id: "heartRate",
    label: "Heart rate",
    fields: [byField("restingHr"), byField("maxHr"), byField("lthr")],
  },
  { id: "running", label: "Running", fields: [byField("runThresholdPace")] },
  { id: "swimming", label: "Swimming", fields: [byField("swimThresholdPace")] },
];
