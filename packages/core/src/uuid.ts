/**
 * UUIDv7 (RFC 9562): 48-bit unix ms timestamp, version 7, variant 10,
 * a 12-bit counter in rand_a for monotonicity within a millisecond,
 * and random bits for the rest. Generated offline, sortable by creation time.
 */

export interface UuidV7Options {
  now?: () => number;
  random?: (bytes: Uint8Array) => void;
}

const MAX_COUNTER = 0xfff;

export function createUuidV7Generator(options: UuidV7Options = {}): () => string {
  const now = options.now ?? Date.now;
  const random = options.random ?? ((b: Uint8Array) => void globalThis.crypto.getRandomValues(b));

  let lastMs = -1;
  let counter = 0;

  return function uuidv7(): string {
    const current = now();
    if (current > lastMs) {
      lastMs = current;
      counter = 0;
    } else {
      // Same millisecond, or the clock stepped back: stay monotonic.
      counter += 1;
      if (counter > MAX_COUNTER) {
        lastMs += 1;
        counter = 0;
      }
    }

    const bytes = new Uint8Array(16);
    random(bytes);

    // 48-bit timestamp, big-endian. Divide rather than shift: JS bit ops are 32-bit.
    let t = lastMs;
    for (let i = 5; i >= 0; i--) {
      bytes[i] = t % 256;
      t = Math.floor(t / 256);
    }
    bytes[6] = 0x70 | (counter >> 8); // version 7 + counter high 4 bits
    bytes[7] = counter & 0xff; // counter low 8 bits
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

export const uuidv7 = createUuidV7Generator();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV7(value: string): boolean {
  return UUID_RE.test(value);
}

/** Extract the embedded unix ms timestamp from a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  if (!isUuidV7(id)) throw new Error(`Not a UUIDv7: ${id}`);
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
