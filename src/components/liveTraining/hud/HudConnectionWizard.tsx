import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/useT";
import type { ConnectionState, SensorSource } from "~/sensors/types";

interface HudDeviceCardProps {
  type: "heartRate" | "trainer";
  state: ConnectionState;
  deviceName: string | null;
  source: SensorSource;
  onSourceChange: (s: SensorSource) => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

function HudDeviceCard({
  type,
  state,
  deviceName,
  source,
  onSourceChange,
  onConnect,
  onDisconnect,
}: HudDeviceCardProps) {
  const t = useT();
  const isConnected = state === "connected";
  const isConnecting = state === "connecting";
  const label =
    type === "heartRate"
      ? t("liveTraining.heartRate")
      : t("liveTraining.trainer");

  return (
    <div
      className={`relative w-full max-w-80 overflow-hidden rounded-2xl border backdrop-blur-md transition-all duration-700 sm:min-w-80 sm:max-w-none ${
        isConnected
          ? "border-green-400/50 bg-green-50 dark:border-green-500/40 dark:bg-green-950/30"
          : "border-border/50 bg-card/60"
      }`}
    >
      <div className="flex flex-col items-center gap-3 p-4 sm:gap-4 sm:p-8">
        {/* Sensor icon with animation */}
        <div className="relative">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-500 sm:h-20 sm:w-20 ${
              isConnected ? "bg-green-100 dark:bg-green-500/20" : "bg-accent/60"
            }`}
          >
            {type === "heartRate" ? (
              <svg
                className={`h-6 w-6 transition-colors duration-500 sm:h-10 sm:w-10 ${isConnected ? "text-green-400" : "text-red-400"}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
              </svg>
            ) : (
              <svg
                className={`h-6 w-6 transition-colors duration-500 sm:h-10 sm:w-10 ${isConnected ? "text-green-400" : "text-teal-400"}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2M5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5m5.8-10 2.4-2.4.8.8c1.3 1.3 3 2.1 5 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5m0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5" />
              </svg>
            )}
          </div>

          {/* Connecting ripple rings */}
          {isConnecting && (
            <>
              <span className="animate-ripple absolute inset-0 rounded-full border-2 border-teal-400/40" />
              <span
                className="animate-ripple absolute inset-0 rounded-full border-2 border-teal-400/20"
                style={{ animationDelay: "0.75s" }}
              />
            </>
          )}

          {/* Connected checkmark overlay */}
          {isConnected && (
            <div className="absolute -right-1 -bottom-1 flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-green-50 shadow-lg shadow-green-500/30">
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          )}
        </div>

        {/* Label + status */}
        <div className="text-center">
          <h3 className="text-foreground text-base font-semibold sm:text-lg">{label}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs sm:mt-1 sm:text-sm">
            {isConnected
              ? (deviceName ?? t("liveTraining.connected"))
              : isConnecting
                ? t("liveTraining.searching")
                : t("liveTraining.notConnected")}
          </p>
        </div>

        {/* BLE/ANT+ toggle */}
        <div className="bg-background/70 flex gap-1 rounded-lg p-1">
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              source === "ble"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onSourceChange("ble")}
            disabled={state !== "disconnected"}
          >
            BLE
          </button>
          <button
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              source === "ant+"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onSourceChange("ant+")}
            disabled={state !== "disconnected"}
          >
            ANT+
          </button>
        </div>

        {/* Connect button */}
        <Button
          onClick={isConnected ? onDisconnect : onConnect}
          disabled={isConnecting}
          className={`w-full ${
            isConnected
              ? "bg-accent hover:bg-accent/80"
              : "bg-primary hover:bg-primary/80"
          }`}
        >
          {isConnected
            ? t("liveTraining.disconnect")
            : isConnecting
              ? t("liveTraining.searching")
              : t("liveTraining.connect")}
        </Button>
      </div>
    </div>
  );
}

interface HudConnectionWizardProps {
  hrState: ConnectionState;
  hrDeviceName: string | null;
  hrSource: SensorSource;
  onHrSourceChange: (s: SensorSource) => void;
  onHrConnect: () => void;
  onHrDisconnect: () => void;
  trainerState: ConnectionState;
  trainerDeviceName: string | null;
  trainerSource: SensorSource;
  onTrainerSourceChange: (s: SensorSource) => void;
  onTrainerConnect: () => void;
  onTrainerDisconnect: () => void;
}

export function HudConnectionWizard(props: HudConnectionWizardProps) {
  const t = useT();
  return (
    <div className="bg-background/95 absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm p-4">
      <div className="flex flex-col items-center gap-4 sm:gap-8">
        <h1 className="text-foreground text-xl font-bold sm:text-3xl">
          {t("liveTraining.connectDevices")}
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          {t("liveTraining.pairSensors")}
        </p>
        <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-6">
          <HudDeviceCard
            type="heartRate"
            state={props.hrState}
            deviceName={props.hrDeviceName}
            source={props.hrSource}
            onSourceChange={props.onHrSourceChange}
            onConnect={props.onHrConnect}
            onDisconnect={props.onHrDisconnect}
          />
          <HudDeviceCard
            type="trainer"
            state={props.trainerState}
            deviceName={props.trainerDeviceName}
            source={props.trainerSource}
            onSourceChange={props.onTrainerSourceChange}
            onConnect={props.onTrainerConnect}
            onDisconnect={props.onTrainerDisconnect}
          />
        </div>
      </div>
    </div>
  );
}
