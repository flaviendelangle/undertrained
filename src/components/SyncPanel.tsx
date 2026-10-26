import * as React from "react";

import {
  AlertCircleIcon,
  ArrowDownToLineIcon,
  CalculatorIcon,
  CheckCircle2Icon,
  InfoIcon,
  Loader2,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react";

import type { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import type { SyncJob } from "@server/db/types";

import { Button } from "~/components/ui/button";
import { Popover, PopoverContent } from "~/components/ui/popover";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "~/components/ui/responsive-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { useAthleteId } from "~/hooks/useAthleteId";
import { useIsMobile } from "~/hooks/useIsMobile";
import { useI18n } from "~/i18n/I18nProvider";
import { useT } from "~/i18n/useT";
import { trpc } from "~/utils/trpc";

type SyncMode = NonNullable<SyncJob["mode"]>;

// ── Progress bar ─────────────────────────────────────────────────────

function ProgressBar(props: { value: number; max: number }) {
  const pct = props.max > 0 ? Math.round((props.value / props.max) * 100) : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="bg-muted h-1.5 flex-1 rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-muted-foreground min-w-[3ch] text-right text-xs tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

// ── Sync progress display ────────────────────────────────────────────

function SyncProgress(props: {
  syncJob: {
    status: string;
    mode: SyncMode | null;
    activitiesFetched: number;
    activitiesPagesComplete: boolean;
    streamsTotal: number;
    streamsFetched: number;
  };
}) {
  const t = useT();
  const { syncJob } = props;
  const mode = syncJob.mode ?? "load_missing";

  const phaseLabel =
    mode === "load_new"
      ? t("sync.status.checkingNew")
      : mode === "reload_all"
        ? t("sync.status.downloadingAll")
        : mode === "recompute_scores"
          ? t("sync.status.computingScores")
          : t("sync.status.scanningAll");

  const header = (
    <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
      <Loader2 className="size-3 animate-spin" />
      {phaseLabel}
    </div>
  );

  // For recompute_scores, skip activity/stream phases
  if (mode === "recompute_scores") {
    return <div className="flex flex-col gap-2">{header}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {header}

      {/* Activities phase */}
      <div className="flex items-center gap-2">
        {syncJob.activitiesPagesComplete ? (
          <CheckCircle2Icon className="size-3.5 shrink-0 text-green-500" />
        ) : (
          <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
        )}
        <span className="text-xs">
          {t("sync.progress.activitiesLoaded", {
            count: syncJob.activitiesFetched,
          })}
        </span>
      </div>

      {/* Streams phase */}
      {syncJob.status === "fetching_activities" && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <div className="size-3.5 shrink-0" />
          <span>{t("sync.progress.streamsWaiting")}</span>
        </div>
      )}
      {(syncJob.status === "fetching_streams" ||
        syncJob.status === "computing_scores") && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {syncJob.status === "computing_scores" ? (
              <CheckCircle2Icon className="size-3.5 shrink-0 text-green-500" />
            ) : (
              <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
            )}
            <span className="text-xs">
              {t("sync.progress.streamsCount", {
                loaded: syncJob.streamsFetched,
                total: syncJob.streamsTotal,
              })}
            </span>
          </div>
          {syncJob.streamsTotal > 0 && (
            <div className="pl-5.5">
              <ProgressBar
                value={syncJob.streamsFetched}
                max={syncJob.streamsTotal}
              />
            </div>
          )}
        </div>
      )}

      {/* Score computation phase */}
      {syncJob.status === "computing_scores" && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <span>{t("sync.status.computingScores")}</span>
        </div>
      )}
    </div>
  );
}

// ── Action button with info tooltip ──────────────────────────────────

function SyncAction(props: {
  icon: React.ReactNode;
  label: string;
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "secondary" | "destructive";
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-1">
      <Button
        variant={props.variant ?? "secondary"}
        size="sm"
        className="h-auto min-h-8 min-w-0 flex-1 justify-start gap-1.5 py-1 text-left whitespace-normal"
        aria-label={props.label}
        disabled={props.disabled || props.loading}
        onClick={props.onClick}
      >
        {props.loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          props.icon
        )}
        {props.label}
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("sync.action.infoAbout", { label: props.label })}
            />
          }
        >
          <InfoIcon className="text-muted-foreground size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-52">
          {props.tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ── Confirm dialog for reload all ────────────────────────────────────

function ReloadAllConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <ResponsiveDialog open={props.open} onOpenChange={props.onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {t("sync.reloadDialog.title")}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {t("sync.reloadDialog.description")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose render={<Button variant="outline" />}>
            {t("common.cancel")}
          </ResponsiveDialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
            {t("sync.button.reloadAll")}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ── First sync view ──────────────────────────────────────────────────

function FirstSyncContent(props: { onSync: () => void; loading: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        {t("sync.firstSync.prompt")}
      </p>
      <Button
        size="sm"
        className="w-full gap-1.5"
        disabled={props.loading}
        onClick={props.onSync}
      >
        {props.loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCwIcon className="size-3.5" />
        )}
        {t("sync.button.loadAll")}
      </Button>
    </div>
  );
}

// ── Idle actions view ────────────────────────────────────────────────

function IdleContent(props: {
  syncJob: {
    status: string;
    lastError: string | null;
    startedAt: number;
  } | null;
  onAction: (mode: SyncMode) => void;
  recomputing: boolean;
}) {
  const t = useT();
  const { syncJob } = props;

  return (
    <div className="flex flex-col gap-2">
      <SyncAction
        icon={<ArrowDownToLineIcon className="size-3.5" />}
        label={t("sync.button.loadNew")}
        tooltip={t("sync.tooltip.loadNew")}
        onClick={() => props.onAction("load_new")}
      />

      <SyncAction
        icon={<SearchIcon className="size-3.5" />}
        label={t("sync.button.loadMissing")}
        tooltip={t("sync.tooltip.loadMissing")}
        onClick={() => props.onAction("load_missing")}
      />

      <div className="border-border border-t" />

      <SyncAction
        icon={<RotateCcwIcon className="size-3.5" />}
        label={t("sync.button.reloadAllActivities")}
        tooltip={t("sync.tooltip.reloadAll")}
        onClick={() => props.onAction("reload_all")}
      />

      <div className="border-border border-t" />

      <SyncAction
        icon={<CalculatorIcon className="size-3.5" />}
        label={t("sync.button.recomputeScores")}
        tooltip={t("sync.tooltip.recomputeScores")}
        onClick={() => props.onAction("recompute_scores")}
        loading={props.recomputing}
      />

      {syncJob?.status === "failed" && syncJob.lastError && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircleIcon className="size-3.5 shrink-0" />
          <span>{t("sync.status.lastFailed")}</span>
        </div>
      )}

      {syncJob?.status === "completed" && (
        <span className="text-muted-foreground text-xs">
          {t("sync.status.lastSynced")}{" "}
          {new Date(syncJob.startedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}

// ── Main SyncPanel ───────────────────────────────────────────────────

export function SyncPanel({
  open,
  onOpenChange: setOpen,
  handle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handle: PopoverPrimitive.Handle<unknown>;
}) {
  const mobile = useIsMobile();
  const t = useT();
  const { locale } = useI18n();
  const athleteId = useAthleteId();
  const { data: syncStatus } = trpc.sync.getStatus.useQuery(
    { athleteId },
    {
      refetchInterval: (query) => {
        const data = query.state.data?.job;
        if (data && data.status !== "completed" && data.status !== "failed") {
          return 3000;
        }
        return open ? 30_000 : false;
      },
    },
  );
  const syncJob = syncStatus?.job;
  const startSync = trpc.sync.start.useMutation();
  const utils = trpc.useUtils();

  const [confirmReloadOpen, setConfirmReloadOpen] = React.useState(false);

  const wasSyncingRef = React.useRef(false);
  const neverSynced = syncJob === null; // null = query returned null, undefined = query loading

  const isInProgress =
    syncJob != null &&
    syncJob.status !== "completed" &&
    syncJob.status !== "failed";

  React.useEffect(() => {
    if (isInProgress) {
      wasSyncingRef.current = true;
      void utils.activities.list.invalidate();
      void utils.activities.maps.invalidate();
    } else if (wasSyncingRef.current) {
      wasSyncingRef.current = false;
      void utils.activities.list.invalidate();
      void utils.activities.maps.invalidate();
      void utils.activities.get.invalidate();
      void utils.analytics.getPowerCurve.invalidate();
      void utils.analytics.getPowerCurveYears.invalidate();
      void utils.analytics.getPowerDistribution.invalidate();
      void utils.views.summary.invalidate();
      void utils.views.counts.invalidate();
    }
  }, [syncJob, isInProgress, utils]);

  const start = (mode: SyncMode) => {
    startSync.mutate(
      { athleteId, mode },
      {
        onSuccess: () => {
          void utils.sync.getStatus.invalidate();
        },
      },
    );
  };

  const handleAction = (mode: SyncMode) => {
    if (mode === "reload_all") {
      setConfirmReloadOpen(true);
      return;
    }
    start(mode);
  };

  React.useEffect(() => {
    if (open) void utils.sync.getStatus.invalidate();
  }, [open, utils]);
  const content = (
    <>
      {" "}
      {isInProgress ? (
        <SyncProgress syncJob={syncJob} />
      ) : neverSynced ? (
        <FirstSyncContent
          onSync={() => handleAction("load_missing")}
          loading={startSync.isPending}
        />
      ) : (
        <IdleContent
          syncJob={syncJob ?? null}
          onAction={handleAction}
          recomputing={startSync.isPending}
        />
      )}
      {syncStatus && (
        <p className="text-muted-foreground border-border mt-3 border-t pt-3 text-xs">
          {t("sync.status.lastWebhookSynced")}{" "}
          {syncStatus.lastWebhookSyncAt == null ? (
            t("sync.status.noWebhookSync")
          ) : (
            <time
              dateTime={new Date(syncStatus.lastWebhookSyncAt).toISOString()}
            >
              {new Date(syncStatus.lastWebhookSyncAt).toLocaleString(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          )}
        </p>
      )}
    </>
  );
  return (
    <>
      {mobile ? (
        <ResponsiveDialog open={open} onOpenChange={setOpen}>
          <ResponsiveDialogContent className="sm:max-w-lg">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{t("sync.label")}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            {content}
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : (
        <Popover handle={handle} open={open} onOpenChange={setOpen}>
          <PopoverContent
            aria-label={t("sync.label")}
            side="right"
            align="end"
            sideOffset={12}
            className="w-96 max-w-(--available-width)"
          >
            {content}
          </PopoverContent>
        </Popover>
      )}
      <ReloadAllConfirmDialog
        open={confirmReloadOpen}
        onOpenChange={setConfirmReloadOpen}
        onConfirm={() => start("reload_all")}
      />
    </>
  );
}
