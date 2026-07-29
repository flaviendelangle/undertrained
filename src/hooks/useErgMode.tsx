import * as React from "react";

import { MAX_TARGET_POWER_WATTS } from "~/sensors/types";

/**
 * Where `targetPower` comes from. "manual" is the rider working the ± buttons;
 * "workout" means a structured workout is driving it, so the controls become a
 * whole-workout intensity bias instead of an absolute watt stepper.
 *
 * Deliberately orthogonal to `ergEnabled`: a workout can be *displayed* on a
 * trainer that cannot be controlled, and ERG can be on with no workout loaded.
 */
export type ErgTargetSource = "manual" | "workout";

interface ErgModeContextValue {
  ergEnabled: boolean;
  setErgEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  targetPower: number;
  setTargetPower: (watts: number) => void;
  targetSource: ErgTargetSource;
  setTargetSource: (source: ErgTargetSource) => void;
  supportsControl: boolean;
  setSupportsControl: (supported: boolean) => void;
}

const ErgModeContext = React.createContext<ErgModeContextValue>({
  ergEnabled: false,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setErgEnabled: () => {},
  targetPower: 150,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setTargetPower: () => {},
  targetSource: "manual",
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setTargetSource: () => {},
  supportsControl: false,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setSupportsControl: () => {},
});

export function ErgModeProvider({ children }: { children: React.ReactNode }) {
  const [ergEnabled, setErgEnabled] = React.useState(false);
  const [targetPower, setTargetPowerState] = React.useState(150);
  const [targetSource, setTargetSource] =
    React.useState<ErgTargetSource>("manual");
  const [supportsControl, setSupportsControl] = React.useState(false);

  const setTargetPower = React.useCallback((watts: number) => {
    setTargetPowerState(
      Math.max(0, Math.min(MAX_TARGET_POWER_WATTS, Math.round(watts))),
    );
  }, []);

  const value = React.useMemo(
    () => ({
      ergEnabled,
      setErgEnabled,
      targetPower,
      setTargetPower,
      targetSource,
      setTargetSource,
      supportsControl,
      setSupportsControl,
    }),
    [ergEnabled, targetPower, setTargetPower, targetSource, supportsControl],
  );

  return <ErgModeContext value={value}>{children}</ErgModeContext>;
}

export function useErgMode() {
  return React.useContext(ErgModeContext);
}
