import { describe, expect, it } from 'vitest';
import { HlcClock, compareHlc, formatHlc, isHlc, parseHlc } from './hlc';

function fakeNow(start: number) {
  let t = start;
  const now = () => t;
  return {
    now,
    set: (v: number) => void (t = v),
    advance: (d: number) => void (t += d),
  };
}

const T0 = 1_760_000_000_000;

describe('format / parse', () => {
  it('round-trips, including device ids that contain dashes', () => {
    const hlc = formatHlc(T0, 255, 'device-with-dashes-1');
    expect(hlc).toBe(`${T0}-00ff-device-with-dashes-1`);
    expect(parseHlc(hlc)).toEqual({ wall: T0, counter: 255, deviceId: 'device-with-dashes-1' });
    expect(isHlc(hlc)).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(() => parseHlc('nope')).toThrow();
    expect(() => formatHlc(T0, 70_000, 'd')).toThrow(RangeError);
    expect(() => formatHlc(T0, 0, '')).toThrow();
  });

  it('string order equals chronological order', () => {
    const a = formatHlc(T0, 0, 'a');
    const b = formatHlc(T0, 1, 'a');
    const c = formatHlc(T0 + 1, 0, 'a');
    expect([c, a, b].sort(compareHlc)).toEqual([a, b, c]);
  });

  it('breaks ties by device id', () => {
    const a = formatHlc(T0, 0, 'aaa');
    const b = formatHlc(T0, 0, 'bbb');
    expect(compareHlc(a, b)).toBeLessThan(0);
  });
});

describe('tick', () => {
  it('is strictly increasing within the same millisecond', () => {
    const clock = new HlcClock({ deviceId: 'd1', now: fakeNow(T0).now });
    const seen = Array.from({ length: 50 }, () => clock.tick());
    for (let i = 1; i < seen.length; i++) {
      expect(compareHlc(seen[i - 1]!, seen[i]!)).toBeLessThan(0);
    }
  });

  it('resets the counter when physical time moves forward', () => {
    const t = fakeNow(T0);
    const clock = new HlcClock({ deviceId: 'd1', now: t.now });
    clock.tick();
    clock.tick();
    t.advance(10);
    expect(parseHlc(clock.tick())).toMatchObject({ wall: T0 + 10, counter: 0 });
  });

  it('never goes backwards when the wall clock does', () => {
    const t = fakeNow(T0);
    const clock = new HlcClock({ deviceId: 'd1', now: t.now });
    const before = clock.tick();
    t.set(T0 - 60_000);
    const after = clock.tick();
    expect(compareHlc(before, after)).toBeLessThan(0);
  });

  it('survives counter overflow by bumping the wall component', () => {
    const clock = new HlcClock({
      deviceId: 'd1',
      now: fakeNow(T0).now,
      initial: formatHlc(T0, 0xffff, 'd1'),
    });
    const next = parseHlc(clock.tick());
    expect(next).toMatchObject({ wall: T0 + 1, counter: 0 });
  });

  it('resumes after restart from a persisted HLC', () => {
    const t = fakeNow(T0);
    const first = new HlcClock({ deviceId: 'd1', now: t.now });
    const last = first.tick();
    t.set(T0 - 1000); // phone clock reset after reboot
    const second = new HlcClock({ deviceId: 'd1', now: t.now, initial: last });
    expect(compareHlc(last, second.tick())).toBeLessThan(0);
  });
});

describe('receive', () => {
  it('orders later local events after a remote event in the future', () => {
    const t = fakeNow(T0);
    const clock = new HlcClock({ deviceId: 'd1', now: t.now });
    const remote = formatHlc(T0 + 1000, 3, 'd2');
    const { hlc, drifted } = clock.receive(remote);
    expect(drifted).toBe(false);
    expect(compareHlc(remote, hlc)).toBeLessThan(0);
    expect(compareHlc(hlc, clock.tick())).toBeLessThan(0);
  });

  it('merges counters when walls are equal', () => {
    const t = fakeNow(T0);
    const clock = new HlcClock({ deviceId: 'd1', now: t.now });
    clock.tick(); // wall T0, counter 0
    const { hlc } = clock.receive(formatHlc(T0, 7, 'd2'));
    expect(parseHlc(hlc)).toMatchObject({ wall: T0, counter: 8 });
  });

  it('uses physical time when it is ahead of both', () => {
    const t = fakeNow(T0);
    const clock = new HlcClock({ deviceId: 'd1', now: t.now });
    clock.tick();
    t.advance(5000);
    const { hlc } = clock.receive(formatHlc(T0 - 100, 9, 'd2'));
    expect(parseHlc(hlc)).toMatchObject({ wall: T0 + 5000, counter: 0 });
  });

  it('clamps and flags a remote clock far in the future', () => {
    const t = fakeNow(T0);
    const clock = new HlcClock({ deviceId: 'd1', now: t.now, maxDriftMs: 60_000 });
    const farFuture = formatHlc(T0 + 24 * 3600 * 1000, 0, 'bad-phone');
    const { hlc, drifted } = clock.receive(farFuture);
    expect(drifted).toBe(true);
    expect(parseHlc(hlc).wall).toBeLessThanOrEqual(T0 + 60_000 + 1);
    // Our own clock did not follow the bad phone a day into the future.
    expect(parseHlc(clock.tick()).wall).toBeLessThan(T0 + 24 * 3600 * 1000);
  });
});
