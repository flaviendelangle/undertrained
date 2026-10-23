import { type ReadonlyStore, Store } from "@base-ui/utils/store";

import type {
  SensorEvents,
  TrainerAdapter,
  TrainerEvents,
  TrainerTargetStatus,
} from "~/sensors/adapter";
import { computeSessionSummary } from "~/sensors/sessionSummary";
import type { SensorAdapters } from "~/sensors/sources";
import {
  SpeedSimulator,
  distanceIncrementMeters,
  msToKmh,
} from "~/sensors/speedFromPower";
import {
  HEART_RATE_READING_TTL_MS,
  type HeartRateData,
  type RiderSettings,
  type SensorConnectOptions,
  type SensorSource,
  type SessionDataPoint,
  type SessionSummary,
  TRAINER_READING_TTL_MS,
  type TrainerData,
} from "~/sensors/types";
import {
  type PlayerSnapshot,
  type ResolvedSegment,
  type StructuredWorkout,
  clampBias,
  flattenWorkout,
  resolveSnapshot,
} from "~/utils/structuredWorkout";
import {
  type BuiltInWorkoutId,
  identifyFtpTest,
} from "~/utils/structuredWorkout/builtIn";

import { type Clock, type TimerId, browserClock } from "./clock";
import { type SensorKind, SensorLink, type SensorStatus } from "./sensorLink";

/** How often a sample is recorded, in milliseconds. */
const TICK_MS = 1000;
/**
 * Ticks between chart refreshes. Re-rendering several hundred bars every
 * second is the main source of jank on the HUD, and the chart is a 10-minute
 * window — a couple of seconds of latency there is invisible.
 */
const CHART_REFRESH_TICKS = 3;
/** How long the trainer must report power while idle before the ride starts. */
const AUTO_START_MS = 2000;
/** Coalesces target changes that land close together into one trainer write. */
const ERG_WRITE_DEBOUNCE_MS = 200;
/**
 * Zwift documents stopping pedaling as the end of a ramp test, but not its
 * exact detection timeout. Ten seconds of measured zero power, never a brief
 * dip or missing data.
 */
const RAMP_STOPPED_SECONDS = 10;
/** How far `extendSegment` may shorten a step before it would swallow it. */
const MIN_REMAINING_AFTER_TRIM_S = 5;

export type RideStatus = "idle" | "running" | "paused" | "stopped";

/** The screen the page shows. */
export type RidePhase = "connection" | "waiting" | "main" | "paused" | "post";

export type SensorRole = "trainer" | "heartRate";

export interface TrainerStatus extends SensorStatus {
  /** Whether the trainer takes a power target, i.e. whether ERG is possible. */
  supportsControl: boolean;
}

export interface ErgStatus {
  enabled: boolean;
  /** The trainer rejected or ignored the last target. */
  error: boolean;
  /**
   * The trainer's verdict on the target it is holding (FE-C only), or null
   * when it holds none.
   */
  targetStatus: TrainerTargetStatus;
}

/** What the sensors say now, or null where a reading has run out. */
export interface LiveReadings {
  power: number | null;
  cadence: number | null;
  heartRate: number | null;
  speedKmh: number | null;
}

export interface WorkoutPlayback extends PlayerSnapshot {
  segments: ResolvedSegment[];
  biasPct: number;
  testMode: boolean;
  /** Whether {@link RideEngine.finishTest} would end the test effort now. */
  canFinishTest: boolean;
}

export interface RideState {
  phase: RidePhase;
  status: RideStatus;
  trainer: TrainerStatus;
  heartRate: SensorStatus;
  live: LiveReadings;
  elapsedSeconds: number;
  /** How long the current pause has lasted. */
  pausedSeconds: number;
  distanceKm: number;
  /** The recording, refreshed every few samples while riding, in full once stopped. */
  chartData: SessionDataPoint[];
  /** Set once a ride with samples is stopped. */
  summary: SessionSummary | null;
  /** Something the rider would lose by leaving: a ride under way, or recorded. */
  hasRide: boolean;
  erg: ErgStatus;
  workout: WorkoutPlayback;
}

export interface RideWorkout {
  name: string;
  structure: StructuredWorkout;
}

export interface RideEngineOptions {
  workout: RideWorkout;
  sensors: SensorAdapters;
  settings: RiderSettings;
  /** Suspends automatic and manual starts until workout prerequisites are met. */
  startSuspended?: boolean;
  clock?: Clock;
}

type TrainerExtra = {
  supportsControl: boolean;
  targetStatus: TrainerTargetStatus;
};

const HEART_RATE: SensorKind<
  HeartRateData,
  SensorEvents<HeartRateData>,
  null
> = {
  idle: null,
  readingTtlMs: HEART_RATE_READING_TTL_MS,
  events: (base) => base,
};

const TRAINER: SensorKind<TrainerData, TrainerEvents, TrainerExtra> = {
  idle: { supportsControl: false, targetStatus: null },
  readingTtlMs: TRAINER_READING_TTL_MS,
  events: (base, update) => ({
    ...base,
    onControlAvailabilityChange: (supportsControl) =>
      update({ supportsControl }),
    onTargetStatusChange: (targetStatus) => update({ targetStatus }),
  }),
};

/**
 * One ride on the live training page: the sensors, the ride clock, the
 * recording, the workout being played and the ERG target the trainer holds.
 *
 * Every rider command, sensor event and sample ends in `commit()`, which
 * applies the ERG and auto-start policies to the new situation and publishes
 * one {@link RideState} snapshot for the page to render.
 *
 * The ride clock is read once per sample, and the workout position, the
 * recorded sample and the ERG target all come from that one reading.
 */
export class RideEngine {
  private readonly clock: Clock;
  private readonly workout: RideWorkout;
  private readonly testId: BuiltInWorkoutId | undefined;
  private readonly trainer: SensorLink<
    TrainerData,
    TrainerEvents,
    TrainerExtra,
    TrainerAdapter
  >;
  private readonly heartRate: SensorLink<
    HeartRateData,
    SensorEvents<HeartRateData>,
    null
  >;
  private readonly state: Store<RideState>;
  readonly store: ReadonlyStore<RideState>;

  private settings: RiderSettings;
  private startSuspended: boolean;
  private heartRateSkipped = false;

  // The ride clock.
  private status: RideStatus = "idle";
  /** Ride time from running stretches that have ended, in milliseconds. */
  private bankedMs = 0;
  private runningSince: number | null = null;
  /** Ride seconds at the last sample or transition, which everything reads. */
  private elapsed = 0;
  private pausedSeconds = 0;
  /** Changes on resume, so even a short pause splits an FTP test effort. */
  private pauseIndex = 0;
  /** Samples while running, counts the pause while paused. */
  private ticker: TimerId | null = null;
  private lastSampleAt = 0;
  private samplesSinceResume = 0;

  // The recording.
  private points: SessionDataPoint[] = [];
  private startTime: Date | null = null;
  private summary: SessionSummary | null = null;
  private chartData: SessionDataPoint[] = [];
  private readonly speed = new SpeedSimulator();
  private speedMs = 0;

  // The workout. Its clock is the ride clock minus `adjustSeconds`, so skip
  // and ±1 min are moves of that offset, and pausing the ride pauses it.
  /**
   * Follows the rider's FTP until the ride starts, then frozen: editing FTP in
   * another tab mid-interval would otherwise shift every target under the
   * rider and make the recorded compliance meaningless.
   */
  private ftpAtStart: number;
  private segments: ResolvedSegment[];
  private adjustSeconds = 0;
  private biasPct = 1;
  /** Set by `endWorkout`, so "done" survives even mid-step. */
  private ended = false;

  // The ramp test's stopped-pedaling detector.
  private zeroSince: number | null = null;
  private hasPedaled = false;

  // ERG.
  private ergEnabled = false;
  private ergError = false;
  /** Whether the trainer could take a target at the last commit. */
  private controllable = false;
  /** The target the trainer was last asked to hold, or null once released. */
  private held: number | null = null;
  private pendingWrite: TimerId | null = null;
  /**
   * Counts commands sent to the trainer. A write that fails after a newer
   * command went out was superseded, not refused, and says nothing.
   */
  private commands = 0;

  private autoStart: TimerId | null = null;

  constructor(options: RideEngineOptions) {
    this.clock = options.clock ?? browserClock;
    this.workout = options.workout;
    this.testId = identifyFtpTest(options.workout.structure);
    this.settings = options.settings;
    this.startSuspended = options.startSuspended ?? false;
    this.ftpAtStart = options.settings.ftp;
    this.segments = flattenWorkout(options.workout.structure, this.ftpAtStart);
    this.trainer = new SensorLink({
      adapters: options.sensors.trainer,
      source: "ant+",
      kind: TRAINER,
      clock: this.clock,
      onChange: (change) => this.commit({ resend: change?.resumed }),
    });
    this.heartRate = new SensorLink({
      adapters: options.sensors.heartRate,
      source: "ant+",
      kind: HEART_RATE,
      clock: this.clock,
      onChange: () => this.commit(),
    });
    this.state = new Store(this.snapshot());
    this.store = this.state;
  }

  // ── Sensors ─────────────────────────────────────────────────────────

  setSource = (role: SensorRole, source: SensorSource) =>
    this.link(role).setSource(source);

  connect = (role: SensorRole, options?: SensorConnectOptions) =>
    this.link(role).connect(options);

  disconnect = (role: SensorRole) => this.link(role).disconnect();

  /** The rider chose to continue without a heart rate sensor. */
  skipHeartRate = () => {
    this.heartRateSkipped = true;
    this.commit();
  };

  // ── The ride ────────────────────────────────────────────────────────

  /** Begins a ride. Every entry point, manual or automatic, goes through this. */
  start = () => {
    if (
      this.status !== "idle" ||
      this.startSuspended ||
      this.segments.length === 0
    )
      return;
    this.status = "running";
    this.runSamples();
    this.resetRampWatch();
    // The trainer has held the first step's target since ERG came on, maybe
    // for minutes; send it again as the ride starts.
    this.commit({ resend: true });
  };

  pause = () => {
    if (this.status !== "running") return;
    this.freezeClock();
    this.status = "paused";
    const pausedAt = this.clock.now();
    this.pausedSeconds = 0;
    this.ticker = this.clock.setInterval(() => {
      this.pausedSeconds = Math.floor((this.clock.now() - pausedAt) / 1000);
      this.publish();
    }, TICK_MS);
    this.resetRampWatch();
    this.commit();
  };

  resume = () => {
    if (this.status !== "paused") return;
    this.pauseIndex++;
    this.status = "running";
    this.pausedSeconds = 0;
    this.runSamples();
    this.commit();
  };

  /** Ends the ride. One with nothing recorded goes back to waiting instead. */
  stop = () => {
    if (this.status !== "running" && this.status !== "paused") return;
    if (this.points.length === 0) {
      this.toIdle();
      this.commit();
      return;
    }
    this.freezeClock();
    this.status = "stopped";
    this.setErg(false);
    this.summary = computeSessionSummary(this.points, this.recordingStart());
    this.chartData = [...this.points];
    this.commit();
  };

  /** Back to waiting after a ride, to ride the same workout again. */
  reset = () => {
    if (this.status !== "stopped") return;
    // Keep the workout, but drop the bias and any skips, which belonged to the
    // ride just ended.
    this.biasPct = 1;
    this.adjustSeconds = 0;
    this.ended = false;
    this.toIdle();
    this.commit();
  };

  /** Everything recorded so far. Grows in place while the ride runs. */
  getDataPoints(): SessionDataPoint[] {
    return this.points;
  }

  /** What has been recorded so far, for saving a ride that was not stopped. */
  summarize(): SessionSummary | null {
    return computeSessionSummary(this.points, this.recordingStart());
  }

  // ── ERG ─────────────────────────────────────────────────────────────

  setErgEnabled = (enabled: boolean) => {
    if (enabled && !this.controllable) return;
    this.setErg(enabled);
    this.commit();
  };

  /**
   * Sends the current target again, for when the trainer may have lost it
   * without anything else changing: a tab coming back from the background.
   */
  reassertTarget = () => this.commit({ resend: true });

  // ── Workout controls ────────────────────────────────────────────────

  adjustBias = (deltaPct: number) => {
    this.biasPct = clampBias(this.biasPct + deltaPct);
    this.commit();
  };

  skipSegment = () => {
    if (this.testId) return;
    const position = this.position();
    if (position.currentSegment == null) return;
    // Skipping the last step finishes the workout rather than running the
    // clock off the end of it.
    if (position.nextSegment == null) this.ended = true;
    else this.adjustSeconds -= position.secondsRemainingInSegment;
    this.commit();
  };

  /** Gives the rider more (positive) or less (negative) time in this step. */
  extendSegment = (deltaSeconds: number) => {
    if (this.testId) return;
    const position = this.position();
    if (position.currentSegment == null) return;

    // Segment boundaries are fixed in workout time, so the only way to change
    // the time left in the current step is to move the workout clock the
    // *opposite* way: raising `adjustSeconds` slows the workout down.
    if (deltaSeconds < 0) {
      // Never cut past the end of the current step — a held button would
      // otherwise run through the whole workout.
      this.adjustSeconds -= Math.min(
        -deltaSeconds,
        Math.max(
          0,
          position.secondsRemainingInSegment - MIN_REMAINING_AFTER_TRIM_S,
        ),
      );
    } else {
      // Rewinding past the start of the current step would drop the rider into
      // the *previous* one, so a step only grows by the time already spent in
      // it — which also caps a stuck button.
      const grow = Math.min(deltaSeconds, position.secondsIntoSegment);
      if (grow <= 0) return;
      this.adjustSeconds += grow;
    }
    this.commit();
  };

  /** Ends the workout but keeps the ride going. */
  endWorkout = () => {
    this.ended = true;
    this.commit();
  };

  /** Ends a ramp test's effort and moves on to its cooldown. */
  finishTest = () => {
    const position = this.position();
    const cooldown = this.cooldown();
    if (!this.canFinishTest(position) || !cooldown) return;
    this.adjustSeconds -= cooldown.startSeconds - position.workoutSeconds;
    this.commit();
  };

  // ── Page inputs ─────────────────────────────────────────────────────

  setRiderSettings(settings: RiderSettings) {
    if (settings === this.settings) return;
    this.settings = settings;
    if (this.status === "idle") this.setFtp(settings.ftp);
    this.commit();
  }

  setStartSuspended(suspended: boolean) {
    if (suspended === this.startSuspended) return;
    this.startSuspended = suspended;
    this.commit();
  }

  /**
   * Lets go of everything, as on leaving the page: timers, and both sensors,
   * whose adapters hand control back to the trainer as they disconnect.
   */
  dispose = () => {
    this.stopTicker();
    this.clock.clearTimeout(this.autoStart);
    this.autoStart = null;
    this.cancelWrite();
    this.trainer.dispose();
    this.heartRate.dispose();
  };

  // ── Internals ───────────────────────────────────────────────────────

  private link(role: SensorRole) {
    return role === "trainer" ? this.trainer : this.heartRate;
  }

  private commit(options?: { resend?: boolean }) {
    this.followControl();
    this.applyErg(options?.resend ?? false);
    this.armAutoStart();
    this.publish();
  }

  private publish() {
    this.state.setState(this.snapshot());
  }

  private snapshot(): RideState {
    const position = this.position();
    return {
      phase: this.phase(),
      status: this.status,
      trainer: { ...this.trainer.status, supportsControl: this.controllable },
      heartRate: this.heartRate.status,
      live: {
        ...this.readings(this.clock.now()),
        speedKmh: this.speedMs > 0.1 ? msToKmh(this.speedMs) : null,
      },
      elapsedSeconds: Math.floor(this.elapsed),
      pausedSeconds: this.pausedSeconds,
      distanceKm: (this.points.at(-1)?.distance ?? 0) / 1000,
      chartData: this.chartData,
      summary: this.summary,
      hasRide:
        this.status === "running" ||
        this.status === "paused" ||
        this.points.length > 0,
      erg: {
        enabled: this.ergEnabled,
        error: this.ergError,
        targetStatus:
          this.held == null ? null : this.trainer.extra.targetStatus,
      },
      workout: {
        ...position,
        // `ended` is the rider saying "I'm done with this", which outranks
        // the clock.
        isFinished: this.ended || position.isFinished,
        targetWatts: this.workoutTarget(position),
        segments: this.segments,
        biasPct: this.bias(),
        testMode: this.testId != null,
        canFinishTest: this.canFinishTest(position),
      },
    };
  }

  private phase(): RidePhase {
    if (this.status === "stopped") return "post";
    if (this.status === "paused") return "paused";
    if (this.status === "running") return "main";
    // Only the trainer is required to ride: heart rate is optional everywhere
    // downstream (the summary, the chart and the FIT record all handle a
    // missing HR), so gating the wizard on it locked out anyone without a
    // strap.
    if (
      this.trainer.connected &&
      (this.heartRateSkipped || this.heartRate.connected)
    )
      return "waiting";
    return "connection";
  }

  /**
   * The one freshness rule, read by the HUD, the recording and the ramp test
   * detector alike. A strap's heart rate wins over the trainer's.
   */
  private readings(now: number): Omit<LiveReadings, "speedKmh"> {
    const trainer = this.trainer.fresh(now);
    const heartRate = this.heartRate.fresh(now);
    return {
      power: trainer?.power ?? null,
      cadence: trainer?.cadence ?? null,
      heartRate: heartRate?.heartRate ?? trainer?.heartRate ?? null,
    };
  }

  // The ride clock.

  private elapsedAt(now: number): number {
    const running = this.runningSince == null ? 0 : now - this.runningSince;
    return (this.bankedMs + running) / 1000;
  }

  /** Starts a running stretch, sampling once a second from now. */
  private runSamples() {
    this.stopTicker();
    const now = this.clock.now();
    this.runningSince = now;
    this.lastSampleAt = now;
    this.samplesSinceResume = 0;
    this.ticker = this.clock.setInterval(() => this.sample(), TICK_MS);
  }

  private freezeClock() {
    this.stopTicker();
    if (this.runningSince != null) {
      this.bankedMs += this.clock.now() - this.runningSince;
      this.runningSince = null;
    }
    this.elapsed = this.bankedMs / 1000;
  }

  private stopTicker() {
    this.clock.clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Back to waiting, with nothing left of the ride. */
  private toIdle() {
    this.stopTicker();
    this.status = "idle";
    this.bankedMs = 0;
    this.runningSince = null;
    this.elapsed = 0;
    this.pausedSeconds = 0;
    this.pauseIndex = 0;
    this.points = [];
    this.startTime = null;
    this.summary = null;
    this.chartData = [];
    this.speed.reset();
    this.speedMs = 0;
    this.setFtp(this.settings.ftp);
  }

  private sample() {
    const now = this.clock.now();
    // Real elapsed time, not the nominal interval: browsers throttle timers in
    // background tabs to about one tick per minute, and assuming 1 s per tick
    // made distance and the physics step collapse while hidden.
    const gapMs = now - this.lastSampleAt;
    const deltaSeconds = gapMs / 1000;
    this.lastSampleAt = now;
    this.elapsed = this.elapsedAt(now);

    const reading = this.readings(now);
    // Simulate speed with inertia (coasts realistically when power drops).
    this.speedMs = this.speed.update(reading.power ?? 0, deltaSeconds, {
      totalMassKg: this.settings.weightKg + this.settings.bikeWeightKg,
      cdA: this.settings.cdA,
      crr: this.settings.crr,
    });
    const position = this.position();
    this.startTime ??= new Date(this.clock.epoch());
    this.points.push({
      timestamp: this.clock.epoch(),
      elapsed: this.elapsed,
      pauseIndex: this.pauseIndex,
      power: reading.power,
      targetPower: this.heldTarget(),
      heartRate: reading.heartRate,
      cadence: reading.cadence,
      speed: this.speedMs,
      distance:
        (this.points.at(-1)?.distance ?? 0) +
        distanceIncrementMeters(this.speedMs, deltaSeconds),
      // No step past the end of the workout, or once the rider has ended it:
      // that keeps riding on out of the compliance figures and the per-step
      // laps.
      segmentIndex:
        this.ended || position.segmentIndex < 0 ? null : position.segmentIndex,
    });
    this.watchRampTest(reading, gapMs, position);

    this.samplesSinceResume++;
    if (this.samplesSinceResume % CHART_REFRESH_TICKS === 0) {
      this.chartData = [...this.points];
    }
    this.commit();
  }

  private recordingStart(): Date {
    return this.startTime ?? new Date(this.clock.epoch());
  }

  // The workout.

  private bias(): number {
    return this.testId ? 1 : this.biasPct;
  }

  private setFtp(ftp: number) {
    if (ftp === this.ftpAtStart) return;
    this.ftpAtStart = ftp;
    this.segments = flattenWorkout(this.workout.structure, ftp);
  }

  /** Where the workout is, on the ride clock as last read. */
  private position(): PlayerSnapshot {
    return this.resolve(this.elapsed - this.adjustSeconds);
  }

  private resolve(workoutSeconds: number): PlayerSnapshot {
    return resolveSnapshot({
      segments: this.segments,
      workoutSeconds,
      ftp: this.ftpAtStart,
      biasPct: this.bias(),
    });
  }

  /**
   * The target the workout asks for now.
   *
   * - running: whatever the workout says, unless the rider ended it early.
   * - idle: the first step's target, so the trainer is already at warm-up
   *   resistance when auto-start fires rather than at whatever was left over.
   * - paused / stopped: nothing, so the trainer stops holding a rider who has
   *   stepped off the bike.
   */
  private workoutTarget(position: PlayerSnapshot): number | null {
    if (this.ended) return null;
    if (this.status === "running") return position.targetWatts;
    if (this.status === "idle") return this.resolve(0).targetWatts;
    return null;
  }

  private cooldown(): ResolvedSegment | undefined {
    return this.segments.find((segment) => segment.intensity === "cooldown");
  }

  private canFinishTest(position: PlayerSnapshot): boolean {
    return (
      this.testId === "ramp-test" &&
      !this.ended &&
      position.currentSegment?.intensity === "work" &&
      this.cooldown() != null
    );
  }

  private resetRampWatch() {
    this.zeroSince = null;
    this.hasPedaled = false;
  }

  /**
   * Ends a ramp test once the rider has stopped pedaling, after having
   * pedaled: ten seconds of measured zero power with the cranks still.
   */
  private watchRampTest(
    reading: Omit<LiveReadings, "speedKmh">,
    gapMs: number,
    position: PlayerSnapshot,
  ) {
    // A suspended tab is not ten seconds of observed zero-power samples.
    if (gapMs >= TRAINER_READING_TTL_MS) this.zeroSince = null;
    if (!this.trainer.connected || !this.canFinishTest(position)) {
      this.resetRampWatch();
      return;
    }
    const { power, cadence } = reading;
    if (power == null || !Number.isFinite(power) || power < 0) {
      this.zeroSince = null;
      return;
    }
    if (power > 0 || (cadence ?? 0) > 0) {
      this.hasPedaled = true;
      this.zeroSince = null;
      return;
    }
    if (!this.hasPedaled) return;
    this.zeroSince ??= this.elapsed;
    if (this.elapsed - this.zeroSince >= RAMP_STOPPED_SECONDS) {
      this.resetRampWatch();
      this.finishTest();
    }
  }

  // ERG.

  private setErg(enabled: boolean) {
    this.ergEnabled = enabled;
    if (!enabled) this.ergError = false;
  }

  /**
   * ERG comes on whenever the trainer becomes controllable, at the first
   * connect and after every reconnect: riding a workout on such a trainer is
   * what the rider asked for, and the toggle is there to opt out. It goes off
   * with the trainer.
   */
  private followControl() {
    const controllable =
      this.trainer.connected && this.trainer.extra.supportsControl;
    if (controllable === this.controllable) return;
    this.controllable = controllable;
    this.setErg(controllable);
  }

  /** The target the trainer should hold right now, or null for none. */
  private heldTarget(): number | null {
    if (!this.ergEnabled || !this.controllable) return null;
    return this.workoutTarget(this.position());
  }

  /**
   * The release policy, and the only place targets are sent from. A target
   * goes out when it changes, when holding begins (ERG on, a reconnect, a
   * resume, the end of a free step) and when `resend` says the trainer may
   * have lost it. Holding ends with one release, whatever ended it: ERG off,
   * a pause, the end of the workout, a free step.
   */
  private applyErg(resend: boolean) {
    const target = this.heldTarget();
    if (target == null) {
      this.cancelWrite();
      if (this.held != null) {
        this.held = null;
        this.release();
      }
      return;
    }
    if (resend || target !== this.held) {
      this.held = target;
      this.scheduleWrite();
    }
  }

  private scheduleWrite() {
    this.cancelWrite();
    this.pendingWrite = this.clock.setTimeout(() => {
      this.pendingWrite = null;
      const target = this.heldTarget();
      if (target == null) return;
      const command = ++this.commands;
      const settle = (error: boolean) => {
        if (command !== this.commands || !this.ergEnabled) return;
        if (error === this.ergError) return;
        this.ergError = error;
        this.publish();
      };
      this.trainer.adapter.setTargetPower(target).then(
        () => settle(false),
        (err: unknown) => {
          console.error("[ERG] Failed to set target power:", err);
          settle(true);
        },
      );
    }, ERG_WRITE_DEBOUNCE_MS);
  }

  private cancelWrite() {
    this.clock.clearTimeout(this.pendingWrite);
    this.pendingWrite = null;
  }

  private release() {
    this.commands++;
    // A trainer that went away dropped its target with it, and the adapter
    // releases on every disconnect() it is asked for.
    if (!this.trainer.connected) return;
    this.trainer.adapter.releaseControl().catch((err: unknown) => {
      console.error("[ERG] Failed to release trainer control:", err);
    });
  }

  private armAutoStart() {
    const power = this.trainer.latest?.power;
    const armed =
      !this.startSuspended &&
      this.trainer.connected &&
      this.status === "idle" &&
      power != null &&
      power > 0;
    if (!armed) {
      this.clock.clearTimeout(this.autoStart);
      this.autoStart = null;
      return;
    }
    this.autoStart ??= this.clock.setTimeout(() => {
      this.autoStart = null;
      this.start();
    }, AUTO_START_MS);
  }
}

/** The workout as the HUD sees it: where it is, and the rider's controls. */
export type WorkoutPlayer = WorkoutPlayback &
  Pick<
    RideEngine,
    "adjustBias" | "skipSegment" | "extendSegment" | "endWorkout" | "finishTest"
  >;
