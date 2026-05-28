import { useT } from "~/i18n/useT";

interface HudWaitingScreenProps {
  currentHr: number | null;
  hrConnected: boolean;
  onManualStart: () => void;
  ergEnabled: boolean;
  onErgEnabledChange: (enabled: boolean) => void;
  targetPower: number;
  onTargetPowerChange: (watts: number) => void;
  supportsControl: boolean;
}

export function HudWaitingScreen({
  currentHr,
  hrConnected,
  onManualStart,
  ergEnabled,
  onErgEnabledChange,
  targetPower,
  onTargetPowerChange,
  supportsControl,
}: HudWaitingScreenProps) {
  const t = useT();
  return (
    <div className="from-background to-background absolute inset-0 z-40 flex items-center justify-center bg-linear-to-br">
      {/* Live HR badge */}
      {hrConnected && currentHr != null && (
        <div className="border-border/50 bg-card/70 absolute top-6 left-6 flex items-center gap-2 rounded-full border px-4 py-2 backdrop-blur-sm">
          <svg
            className="h-4 w-4 text-red-400"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <span className="font-mono text-sm text-red-400">{currentHr}</span>
          <span className="text-muted-foreground text-xs">bpm</span>
        </div>
      )}

      {/* Center content */}
      <div className="flex flex-col items-center gap-6">
        {/* Pedal icon */}
        <div className="relative">
          <svg
            className="text-muted-foreground h-20 w-20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2M5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5m5.8-10 2.4-2.4.8.8c1.3 1.3 3 2.1 5 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5" />
          </svg>
        </div>

        <p className="animate-breathe text-muted-foreground text-2xl font-light tracking-wide">
          {t("liveTraining.startPedaling")}
        </p>

        {/* ERG mode toggle */}
        {supportsControl && (
          <div
            className={`flex flex-col gap-4 rounded-2xl border px-6 py-4 backdrop-blur-md transition-all duration-500 ${
              ergEnabled
                ? "border-yellow-400/50 bg-yellow-50 dark:border-yellow-500/40 dark:bg-yellow-950/30"
                : "border-border/50 bg-card/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg
                  className={`h-5 w-5 transition-colors duration-500 ${
                    ergEnabled
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-muted-foreground"
                  }`}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M7 2v11h3v9l7-12h-4l4-8z" />
                </svg>
                <span className="text-foreground text-sm font-medium">
                  {t("liveTraining.ergMode")}
                </span>
              </div>
              <button
                onClick={() => onErgEnabledChange(!ergEnabled)}
                className={`relative ml-6 h-6 w-11 rounded-full transition-colors duration-300 ${
                  ergEnabled ? "bg-yellow-500" : "bg-accent"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-300 ${
                    ergEnabled ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>

            {ergEnabled && (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => onTargetPowerChange(targetPower - 10)}
                  className="border-border text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors hover:border-yellow-500/60"
                >
                  -10
                </button>
                <button
                  onClick={() => onTargetPowerChange(targetPower - 5)}
                  className="border-border text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors hover:border-yellow-500/60"
                >
                  -5
                </button>
                <span className="min-w-20 text-center font-mono text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {targetPower}
                  <span className="text-muted-foreground ml-1 text-xs font-normal">
                    W
                  </span>
                </span>
                <button
                  onClick={() => onTargetPowerChange(targetPower + 5)}
                  className="border-border text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors hover:border-yellow-500/60"
                >
                  +5
                </button>
                <button
                  onClick={() => onTargetPowerChange(targetPower + 10)}
                  className="border-border text-muted-foreground hover:text-foreground flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors hover:border-yellow-500/60"
                >
                  +10
                </button>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onManualStart}
          className="border-border text-muted-foreground hover:border-border hover:text-foreground mt-4 rounded-full border px-6 py-2 text-sm transition-colors"
        >
          {t("liveTraining.startManually")}
        </button>
      </div>
    </div>
  );
}
