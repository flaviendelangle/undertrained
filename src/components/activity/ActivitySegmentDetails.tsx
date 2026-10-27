import * as React from "react";

import { ArrowRightIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";
import { useT } from "~/i18n/useT";
import type { ActivityRecording } from "~/lib/activityRecording";
import type { RecordingSegment } from "~/lib/activityRecording/segment";
import { cn } from "~/lib/utils";
import { formatElapsed } from "~/utils/format";

import { SegmentElevationProfile } from "./SegmentElevationProfile";

export function ActivitySegmentDetails({
  segment,
  recording,
  metrics,
  mobile,
  onClear,
}: {
  segment: RecordingSegment;
  recording: ActivityRecording;
  metrics: { label: string; value: string }[];
  mobile: boolean;
  onClear: () => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!mobile) return;
    // Mount closed, then let Base UI animate the committed segment's drawer in.
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [mobile]);
  const metricGrid = (rows: typeof metrics) =>
    rows.map((metric) => (
      <div key={metric.label}>
        <dt className="text-muted-foreground text-xs">{metric.label}</dt>
        <dd className="mt-0.5 text-sm font-semibold tabular-nums">
          {metric.value}
        </dd>
      </div>
    ));
  return (
    <Drawer
      open={open}
      side={mobile ? "bottom" : "right"}
      onOpenChange={setOpen}
      onOpenChangeComplete={(value) => {
        if (!value && mobile) onClear();
      }}
    >
      {!mobile && (
        <section
          aria-label={t("activities.inspection.selected")}
          className="bg-background/95 border-border absolute bottom-8 left-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-5 rounded-lg border p-3 shadow-lg backdrop-blur-sm"
        >
          <dl className="grid grid-cols-2 gap-5">
            {metricGrid(metrics.slice(0, 2))}
          </dl>
          <DrawerTrigger render={<Button variant="outline" size="sm" />}>
            {t("activities.inspection.details")}
            <ArrowRightIcon />
          </DrawerTrigger>
        </section>
      )}
      <DrawerContent
        showCloseButton={false}
        backdropProps={{ forceRender: true }}
        className={cn(
          "px-4",
          mobile ? "max-h-[85svh]" : "w-[min(30rem,100vw)]",
        )}
      >
        <div>
          <div className="bg-background sticky top-0 z-10 -mx-1 flex items-start justify-between gap-3 px-1 pb-4">
            <div className="min-w-0">
              <DrawerTitle className="text-base font-semibold">
                {t("activities.inspection.selected")}
              </DrawerTitle>
              <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                {formatElapsed(segment[0])} – {formatElapsed(segment[1])}
              </p>
            </div>
            <DrawerClose
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("common.close")}
                  title={t("common.close")}
                />
              }
            >
              <XIcon />
            </DrawerClose>
          </div>
          <SegmentElevationProfile recording={recording} segment={segment} />
          <dl className="border-border mt-5 grid grid-cols-3 gap-x-4 gap-y-4 border-t pt-4">
            {metricGrid(metrics)}
          </dl>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
