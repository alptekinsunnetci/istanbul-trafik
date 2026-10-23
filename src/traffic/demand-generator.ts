import { DEMAND } from '../core/constants';
import type { Random } from '../core/random';
import type { Building, TripRequest } from '../core/world-state';

export interface DemandContext {
  time: number;
  dt: number;
  buildings: readonly Building[];
  rng: Random;
  nextTripId: () => number;
  /** Whether a house currently has a route to a workplace. */
  reachable: (house: Building, workplace: Building) => boolean;
}

/**
 * Colour-matched demand. Every workplace periodically receives a "pin": a
 * trip request that is assigned to a house of the same colour. Reachable
 * houses are preferred, and pins waiting at unreachable houses are moved to
 * reachable ones, so connecting a house to its workplace always helps.
 */
export class DemandGenerator {
  multiplier: number;
  reassignTimer = 0;

  constructor(multiplier = 1) {
    this.multiplier = multiplier;
  }

  /** Seconds between pins at one workplace. */
  pinInterval(time: number): number {
    const base = Math.max(
      DEMAND.pinIntervalMin,
      DEMAND.pinInterval - DEMAND.pinIntervalDecayPerMinute * (time / 60),
    );
    return base / this.multiplier;
  }

  update(ctx: DemandContext): TripRequest[] {
    const created: TripRequest[] = [];
    for (const w of ctx.buildings) {
      if (w.kind !== 'ticari' || !isActive(w, ctx.time)) continue;
      w.pinTimer -= ctx.dt;
      if (w.pinTimer > 0) continue;
      w.pinTimer += this.pinInterval(ctx.time);
      const trip = this.createPin(w, ctx);
      if (trip) created.push(trip);
    }
    this.reassignTimer += ctx.dt;
    if (this.reassignTimer >= DEMAND.reassignInterval) {
      this.reassignTimer = 0;
      reassign(ctx);
    }
    return created;
  }

  private createPin(w: Building, ctx: DemandContext): TripRequest | null {
    const houses = ctx.buildings.filter(
      (b) =>
        b.kind === 'konut' &&
        b.color === w.color &&
        isActive(b, ctx.time) &&
        b.pending.length < DEMAND.maxPendingPerHouse,
    );
    if (houses.length === 0) return null;
    const reachable = houses.filter((h) => ctx.reachable(h, w));
    const pool = reachable.length > 0 ? reachable : houses;
    const i = ctx.rng.weightedIndex(
      pool.map((h) => 1 / (1 + h.pending.length) / (1 + Math.hypot(h.x - w.x, h.y - w.y) / 20)),
    );
    const house = pool[i < 0 ? 0 : i] as Building;
    const trip: TripRequest = {
      id: ctx.nextTripId(),
      origin: house.id,
      destination: w.id,
      createdAt: ctx.time,
    };
    house.pending.push(trip);
    return trip;
  }
}

function isActive(b: Building, time: number): boolean {
  return time - b.createdAt >= DEMAND.newBuildingGrace;
}

/** Moves pending trips from houses without a route to same-coloured houses that have one. */
function reassign(ctx: DemandContext): void {
  const byId = new Map<number, Building>();
  for (const b of ctx.buildings) byId.set(b.id, b);
  for (const h of ctx.buildings) {
    if (h.kind !== 'konut' || h.pending.length === 0) continue;
    for (const trip of [...h.pending]) {
      const w = byId.get(trip.destination);
      if (!w || ctx.reachable(h, w)) continue;
      const better = ctx.buildings.find(
        (o) =>
          o !== h &&
          o.kind === 'konut' &&
          o.color === h.color &&
          isActive(o, ctx.time) &&
          o.pending.length < DEMAND.maxPendingPerHouse &&
          ctx.reachable(o, w),
      );
      if (!better) continue;
      h.pending.splice(h.pending.indexOf(trip), 1);
      better.pending.push({ ...trip, origin: better.id });
    }
  }
}

/** Pins shown on a workplace: trips waiting for a car plus cars on their way. */
export function pinsAt(buildings: readonly Building[], workplace: Building): number {
  let n = workplace.incoming;
  for (const b of buildings) for (const t of b.pending) if (t.destination === workplace.id) n++;
  return n;
}

/** Fraction (0..1) of the overflow timer that is used up (stored as a fraction). */
export function overflowUsed(b: Building): number {
  return Math.min(1, b.overflow);
}
