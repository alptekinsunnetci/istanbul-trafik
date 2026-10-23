/**
 * Small deterministic PRNG (mulberry32). The state is a single uint32, which
 * makes it trivial to serialise in save games.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Random.pick: boş liste');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Index chosen proportionally to non-negative weights, or -1 if all are zero. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return -1;
    let r = this.next() * total;
    let lastPositive = -1;
    for (let i = 0; i < weights.length; i++) {
      const w = Math.max(0, weights[i] as number);
      if (w > 0) lastPositive = i;
      r -= w;
      if (r < 0 && w > 0) return i;
    }
    // Rounding can leave a tiny remainder: never return an entry with zero weight.
    return lastPositive;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** Stable 32-bit hash of a string (FNV-1a), used to derive seeds. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
