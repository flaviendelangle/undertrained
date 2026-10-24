import { useEffect, useState } from "react";

import { useStore } from "@base-ui/utils/store";
import { useStableCallback } from "@base-ui/utils/useStableCallback";

import { useRiderSettings } from "~/hooks/useRiderSettings";
import {
  RideEngine,
  type RideState,
  type RideWorkout,
  type WorkoutPlayer,
} from "~/liveTraining/rideEngine";
import { createSensorAdapters } from "~/sensors/sources";

export interface UseRideEngineOptions {
  /**
   * The selected workout, loaded before the ride mounts. Read once: the page
   * mounts a new ride for another workout.
   */
  workout: RideWorkout;
  /** Suspends automatic and manual starts until workout prerequisites are met. */
  startSuspended?: boolean;
}

const selectRide = (state: RideState) => state;

/**
 * Runs one {@link RideEngine} for as long as the page is mounted, and renders
 * whatever it publishes.
 */
export function useRideEngine({
  workout,
  startSuspended = false,
}: UseRideEngineOptions) {
  const [riderSettings] = useRiderSettings();
  const rollingResistance = useStableCallback(() => riderSettings.crr);
  const [engine] = useState(
    () =>
      new RideEngine({
        workout,
        sensors: createSensorAdapters({ rollingResistance }),
        settings: riderSettings,
        startSuspended,
      }),
  );

  useEffect(() => {
    engine.setRiderSettings(riderSettings);
  }, [engine, riderSettings]);

  useEffect(() => {
    engine.setStartSuspended(startSuspended);
  }, [engine, startSuspended]);

  useEffect(() => {
    // The trainer may have lost its target while the tab was in the
    // background, with nothing else about the ride changing.
    const onVisible = () => {
      if (document.visibilityState === "visible") engine.reassertTarget();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      engine.dispose();
    };
  }, [engine]);

  const ride = useStore(engine.store, selectRide);
  const player: WorkoutPlayer = {
    ...ride.workout,
    adjustBias: engine.adjustBias,
    skipSegment: engine.skipSegment,
    extendSegment: engine.extendSegment,
    endWorkout: engine.endWorkout,
    finishTest: engine.finishTest,
  };

  return { engine, ride, player, riderSettings };
}
