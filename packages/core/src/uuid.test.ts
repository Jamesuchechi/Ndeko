import { describe, expect, it } from 'vitest';
import { createUuidV7Generator, isUuidV7, uuidv7, uuidv7Timestamp } from './uuid';

describe('uuidv7', () => {
  it('has the right shape, version and variant', () => {
    const id = uuidv7();
    expect(isUuidV7(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect('89ab').toContain(id[19]!);
  });

  it('embeds the timestamp', () => {
    const gen = createUuidV7Generator({ now: () => 1_760_000_000_123 });
    expect(uuidv7Timestamp(gen())).toBe(1_760_000_000_123);
  });

  it('is unique and sorts in creation order, even within one millisecond', () => {
    const gen = createUuidV7Generator({ now: () => 1_760_000_000_000 });
    const ids = Array.from({ length: 5000 }, () => gen());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it('stays monotonic if the clock steps backwards', () => {
    let t = 1_760_000_000_500;
    const gen = createUuidV7Generator({ now: () => t });
    const a = gen();
    t -= 1000;
    const b = gen();
    expect(a < b).toBe(true);
  });

  it('rolls into the next millisecond on counter overflow', () => {
    const gen = createUuidV7Generator({ now: () => 1_760_000_000_000 });
    const ids = Array.from({ length: 4200 }, () => gen());
    expect([...ids].sort()).toEqual(ids);
    expect(uuidv7Timestamp(ids.at(-1)!)).toBeGreaterThan(1_760_000_000_000);
  });

  it('rejects non-v7 input for timestamp extraction', () => {
    expect(() => uuidv7Timestamp('123e4567-e89b-42d3-a456-426614174000')).toThrow();
  });
});
