import * as React from "react";

import { SlicePrecision } from "~/hooks/useTimeSlices";
import { type TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";

import { Select, SelectProps } from "./primitives/Select";

export const createPrecisions = (t: TFunction): PrecisionConfig[] => [
  {
    value: "year",
    label: t("activities.precision.year"),
  },
  {
    value: "quarter",
    label: t("activities.precision.quarter"),
  },
  {
    value: "month",
    label: t("activities.precision.month"),
  },
  {
    value: "week",
    label: t("activities.precision.week"),
  },
];

export function PrecisionSelect(
  props: Omit<SelectProps<SlicePrecision>, "options">,
) {
  const t = useT();
  const precisions = React.useMemo(() => createPrecisions(t), [t]);
  return <Select {...props} options={precisions} />;
}

interface PrecisionConfig {
  value: SlicePrecision;
  label: string;
}
