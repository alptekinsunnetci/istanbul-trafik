import type { Dir } from '../map/grid';
import type { Turn } from '../map/road-graph';

/**
 * Every junction box is split into four conflict zones (quadrants):
 * 0 = NE, 1 = SE, 2 = SW, 3 = NW. With right-hand traffic a vehicle enters
 * through the quadrant at its back-right and sweeps counter-clockwise:
 * right turn → 1 zone, straight → 2, left → 3, U-turn → 4.
 * Two movements conflict exactly when their zone sets intersect.
 */
export const ZONE_COUNT = 4;

const ZONES_BY_TURN: Record<Turn, number> = { right: 1, straight: 2, left: 3, uturn: 4 };

export function zonesFor(inDir: Dir, turn: Turn): number[] {
  const start = (inDir + 1) % 4;
  const count = ZONES_BY_TURN[turn];
  const zones: number[] = [];
  for (let k = 0; k < count; k++) zones.push((start - k + 8) % 4);
  return zones;
}

export const ALL_ZONES: readonly number[] = [0, 1, 2, 3];

export function zonesOverlap(a: readonly number[], b: readonly number[]): boolean {
  for (const z of a) if (b.includes(z)) return true;
  return false;
}
