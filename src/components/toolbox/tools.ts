import { CogIcon, GaugeIcon, TimerIcon, TrendingUpIcon } from "lucide-react";

import { type TFunction } from "~/i18n/I18nProvider";

/** The Toolbox tabs, each at `/toolbox/<id>`. */
export const TOOLS = [
  { id: "pace-calculator", icon: TimerIcon },
  { id: "race-predictor", icon: TrendingUpIcon },
  { id: "zone-calculator", icon: GaugeIcon },
  { id: "gear-calculator", icon: CogIcon },
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];

export const createToolLabels = (t: TFunction): Record<ToolId, string> => ({
  "pace-calculator": t("toolbox.tool.paceCalculator"),
  "race-predictor": t("toolbox.tool.racePredictor"),
  "zone-calculator": t("toolbox.tool.zoneCalculator"),
  "gear-calculator": t("toolbox.tool.gearCalculator"),
});
