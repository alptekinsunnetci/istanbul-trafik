import { GROWTH } from '../core/constants';

/** Seconds until the next growth event, shrinking gradually with time. */
export function growthInterval(time: number): number {
  const minutes = time / 60;
  return Math.max(GROWTH.intervalMin, GROWTH.intervalStart - GROWTH.intervalDecayPerMinute * minutes);
}

/** Whether the n-th growth event (0-based) adds a workplace rather than a house. */
export function growthAddsWorkplace(n: number): boolean {
  return (n + 1) % GROWTH.workplaceEvery === 0;
}
