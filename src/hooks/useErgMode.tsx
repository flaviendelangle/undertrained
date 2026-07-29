import * as React from "react";

import { MAX_TARGET_POWER_WATTS } from "~/sensors/types";

interface ErgModeContextValue {
  ergEnabled: boolean;
  setErgEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  targetPower: number;
  setTargetPower: (watts: number) => void;
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
  supportsControl: false,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setSupportsControl: () => {},
});

export function ErgModeProvider({ children }: { children: React.ReactNode }) {
  const [ergEnabled, setErgEnabled] = React.useState(false);
  const [targetPower, setTargetPowerState] = React.useState(150);
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
      supportsControl,
      setSupportsControl,
    }),
    [ergEnabled, targetPower, setTargetPower, supportsControl],
  );

  return <ErgModeContext value={value}>{children}</ErgModeContext>;
}

export function useErgMode() {
  return React.useContext(ErgModeContext);
}
