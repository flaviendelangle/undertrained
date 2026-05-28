import * as React from "react";

import {
  ActivityIcon,
  CogIcon,
  GaugeIcon,
  TimerIcon,
  TrendingUpIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/router";

import { LoggedInLayout } from "~/components/layouts/LoggedInLayout";
import { SharedLayout } from "~/components/layouts/SharedLayout";
import { Toolbar } from "~/components/settings/SettingsToolbar";
import { GearCalculator } from "~/components/toolbox/GearCalculator";
import { PaceCalculator } from "~/components/toolbox/PaceCalculator";
import { RacePredictor } from "~/components/toolbox/RacePredictor";
import { ZoneCalculator } from "~/components/toolbox/ZoneCalculator";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { type TFunction } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import type { NextPageWithLayout } from "~/pages/_app";

const TOOLS = [
  { id: "pace-calculator", icon: TimerIcon },
  { id: "race-predictor", icon: TrendingUpIcon },
  { id: "zone-calculator", icon: GaugeIcon },
  { id: "gear-calculator", icon: CogIcon },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

const createToolLabels = (t: TFunction): Record<ToolId, string> => ({
  "pace-calculator": t("toolbox.tool.paceCalculator"),
  "race-predictor": t("toolbox.tool.racePredictor"),
  "zone-calculator": t("toolbox.tool.zoneCalculator"),
  "gear-calculator": t("toolbox.tool.gearCalculator"),
});

const ToolboxPage: NextPageWithLayout = () => {
  const t = useT();
  const toolLabels = React.useMemo(() => createToolLabels(t), [t]);
  const router = useRouter();
  const rawTab = Array.isArray(router.query.tab)
    ? router.query.tab[0]
    : undefined;
  const activeTool = TOOLS.some((t) => t.id === rawTab)
    ? (rawTab as ToolId)
    : undefined;
  const { status } = useSession();

  React.useEffect(() => {
    if (router.isReady && !activeTool) {
      void router.replace(`/toolbox/${TOOLS[0].id}`);
    }
  }, [router, activeTool]);

  if (!activeTool) return null;

  return (
    <>
      <Toolbar
        actions={
          status !== "authenticated" ? (
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm font-medium transition-colors"
            >
              <ActivityIcon className="size-4" />
              {t("toolbox.signIn")}
            </Link>
          ) : undefined
        }
      >
        {/* Mobile: select dropdown */}
        <div className="md:hidden">
          <Select
            value={activeTool}
            onValueChange={(val) => router.push(`/toolbox/${val}`)}
          >
            <SelectTrigger size="sm">
              <SelectValue>
                {(() => {
                  const tool = TOOLS.find((t) => t.id === activeTool)!;
                  const Icon = tool.icon;
                  return (
                    <>
                      <Icon className="size-4" />
                      {toolLabels[tool.id]}
                    </>
                  );
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <SelectItem key={tool.id} value={tool.id}>
                    <Icon className="size-4" />
                    {toolLabels[tool.id]}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop: button tabs */}
        <div className="hidden gap-1 md:flex">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <Button
                key={tool.id}
                variant="ghost"
                size="sm"
                className={
                  activeTool === tool.id
                    ? "bg-primary/10 text-primary"
                    : undefined
                }
                render={<Link href={`/toolbox/${tool.id}`} />}
              >
                <Icon className="size-4" />
                {toolLabels[tool.id]}
              </Button>
            );
          })}
        </div>
      </Toolbar>
      {/* Mobile (< md): the tool goes full-bleed, flush under the toolbar.
          Desktop (md+): padded, matching the Statistics page. */}
      <div className="flex flex-1 flex-col overflow-auto pb-4 md:p-4">
        {activeTool === "pace-calculator" && <PaceCalculator />}
        {activeTool === "race-predictor" && <RacePredictor />}
        {activeTool === "zone-calculator" && <ZoneCalculator />}
        {activeTool === "gear-calculator" && <GearCalculator />}
      </div>
    </>
  );
};

ToolboxPage.getLayout = function getLayout(page) {
  return <ToolboxLayout>{page}</ToolboxLayout>;
};

function ToolboxLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  if (status === "authenticated") {
    return <LoggedInLayout>{children}</LoggedInLayout>;
  }

  return <SharedLayout>{children}</SharedLayout>;
}

export default ToolboxPage;
