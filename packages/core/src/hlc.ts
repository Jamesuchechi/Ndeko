/**
 * Hybrid Logical Clock. See ARCHITECTURE.md section 5.
 *
 * Format: `{wallMs:13 digits}-{counter:4 hex}-{deviceId}`.
 * The wall and counter fields are fixed width, so plain string comparison
 * equals chronological comparison (ties broken by deviceId).
 */

export type Hlc = string;

const WALL_WIDTH = 13;
const COUNTER_WIDTH = 4;
const COUNTER_MAX = 0xffff;
const HLC_RE = /^(\d{13})-([0-9a-f]{4})-(.+)$/;

export const DEFAULT_MAX_DRIFT_MS = 5 * 60 * 1000;

export interface ParsedHlc {
  wall: number;
  counter: number;
  deviceId: string;
}

export function formatHlc(wall: number, counter: number, deviceId: string): Hlc {
  if (!Number.isSafeInteger(wall) || wall < 0 || String(wall).length > WALL_WIDTH) {
    throw new RangeError(`HLC wall out of range: ${wall}`);
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > COUNTER_MAX) {
    throw new RangeError(`HLC counter out of range: ${counter}`);
  }
  if (deviceId.length === 0) throw new Error('HLC deviceId must not be empty');
  const w = String(wall).padStart(WALL_WIDTH, '0');
  const c = counter.toString(16).padStart(COUNTER_WIDTH, '0');
  return `${w}-${c}-${deviceId}`;
}

export function parseHlc(hlc: Hlc): ParsedHlc {
  const match = HLC_RE.exec(hlc);
  if (!match) throw new Error(`Invalid HLC: ${hlc}`);
  return {
    wall: Number(match[1]),
    counter: parseInt(match[2]!, 16),
    deviceId: match[3]!,
  };
}

export function isHlc(value: string): boolean {
  return HLC_RE.test(value);
}

/** Negative if a < b, positive if a > b, 0 if equal. */
export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface HlcClockOptions {
  deviceId: string;
  /** Wall clock source in ms. Injectable for tests and the simulator. */
  now?: () => number;
  /** How far ahead of local time a remote clock may be before it is clamped and flagged. */
  maxDriftMs?: number;
  /** Last HLC persisted by this device, so the clock never goes backwards after restart. */
  initial?: Hlc;
}

export interface ReceiveResult {
  hlc: Hlc;
  /** True if the remote wall time was further ahead than maxDriftMs. Surface a clock warning. */
  drifted: boolean;
}

export class HlcClock {
  readonly deviceId: string;
  private readonly now: () => number;
  private readonly maxDriftMs: number;
  private wall = 0;
  private counter = 0;

  constructor(options: HlcClockOptions) {
    this.deviceId = options.deviceId;
    this.now = options.now ?? Date.now;
    this.maxDriftMs = options.maxDriftMs ?? DEFAULT_MAX_DRIFT_MS;
    if (options.initial) {
      const parsed = parseHlc(options.initial);
      this.wall = parsed.wall;
      this.counter = parsed.counter;
    }
  }

  /** The most recently issued or merged HLC, without advancing the clock. */
  get latest(): Hlc {
    return formatHlc(this.wall, this.counter, this.deviceId);
  }

  /** Issue an HLC for a local event. Strictly greater than every HLC this clock has produced. */
  tick(): Hlc {
    const physical = this.now();
    if (physical > this.wall) {
      this.wall = physical;
      this.counter = 0;
    } else {
      this.advanceCounter();
    }
    return this.latest;
  }

  /**
   * Merge a remote HLC so later local events sort after it.
   * A remote wall time too far in the future is clamped, so one device with a bad
   * clock cannot drag every other device into the future. The event itself is
   * still accepted; the caller decides how to warn the user.
   */
  receive(remote: Hlc): ReceiveResult {
    const parsed = parseHlc(remote);
    const physical = this.now();
    const ceiling = physical + this.maxDriftMs;
    const drifted = parsed.wall > ceiling;
    const remoteWall = Math.min(parsed.wall, ceiling);

    const newWall = Math.max(this.wall, remoteWall, physical);
    let newCounter: number;
    if (newWall === this.wall && newWall === remoteWall) {
      newCounter = Math.max(this.counter, parsed.counter) + 1;
    } else if (newWall === this.wall) {
      newCounter = this.counter + 1;
    } else if (newWall === remoteWall) {
      newCounter = parsed.counter + 1;
    } else {
      newCounter = 0;
    }

    this.wall = newWall;
    this.counter = newCounter;
    if (this.counter > COUNTER_MAX) {
      this.wall += 1;
      this.counter = 0;
    }
    return { hlc: this.latest, drifted };
  }

  private advanceCounter(): void {
    this.counter += 1;
    if (this.counter > COUNTER_MAX) {
      this.wall += 1;
      this.counter = 0;
    }
  }
}
