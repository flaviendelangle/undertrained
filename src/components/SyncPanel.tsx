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

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
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
import { useT } from "~/i18n/useT";
import { cn } from "~/lib/utils";
import { trpc } from "~/utils/trpc";

type SyncMode = "load_new" | "load_missing" | "reload_all" | "recompute_scores";

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

  // For recompute_scores, skip activity/stream phases
  if (mode === "recompute_scores") {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <Loader2 className="size-3 animate-spin" />
          {phaseLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Loader2 className="size-3 animate-spin" />
        {phaseLabel}
      </div>

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
        className="flex-1 justify-start gap-1.5"
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

export function SyncPanel() {
  const t = useT();
  const athleteId = useAthleteId();
  const { data: syncJob } = trpc.sync.getJob.useQuery(
    { athleteId: athleteId! },
    {
      enabled: athleteId != null,
      refetchInterval: (query) => {
        const data = query.state.data;
        if (data && data.status !== "completed" && data.status !== "failed") {
          return 3000;
        }
        return false;
      },
    },
  );
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
    } else if (wasSyncingRef.current) {
      wasSyncingRef.current = false;
      void utils.activities.list.invalidate();
      void utils.activities.get.invalidate();
      void utils.analytics.getPowerCurve.invalidate();
      void utils.analytics.getPowerCurveYears.invalidate();
      void utils.timePeriods.getStats.invalidate();
    }
  }, [syncJob, isInProgress, utils]);

  const handleAction = (mode: SyncMode) => {
    if (!athleteId) return;
    if (mode === "reload_all") {
      setConfirmReloadOpen(true);
      return;
    }
    startSync.mutate(
      { athleteId, mode },
      { onSuccess: () => utils.sync.getJob.invalidate() },
    );
  };

  const handleConfirmReload = () => {
    if (!athleteId) return;
    startSync.mutate(
      { athleteId, mode: "reload_all" },
      { onSuccess: () => utils.sync.getJob.invalidate() },
    );
  };

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <ToolbarPrimitive.Button
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "relative gap-1.5",
                    neverSynced ? "text-primary/70" : "text-muted-foreground",
                  )}
                >
                  {neverSynced && (
                    <span className="absolute -top-1 -right-1 flex size-2.5">
                      <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                      <span className="bg-primary relative inline-flex size-2.5 rounded-full" />
                    </span>
                  )}
                  {isInProgress ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3.5" />
                  )}
                  <span>{t("sync.label")}</span>
                  {isInProgress && (
                    <span className="bg-primary/20 text-primary-foreground size-1.5 rounded-full" />
                  )}
                  {syncJob?.status === "failed" && (
                    <span className="size-1.5 rounded-full bg-red-500" />
                  )}
                </Button>
              }
            />
          }
        />
        <PopoverContent align="end" className="w-72 p-3">
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
        </PopoverContent>
      </Popover>

      <ReloadAllConfirmDialog
        open={confirmReloadOpen}
        onOpenChange={setConfirmReloadOpen}
        onConfirm={handleConfirmReload}
      />
    </>
  );
}
