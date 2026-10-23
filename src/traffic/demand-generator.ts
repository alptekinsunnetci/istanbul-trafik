import { DEMAND, THROUGH, TRANSIT } from '../core/constants';
import type { Random } from '../core/random';
import type { Building, TripRequest } from '../core/world-state';
import { board, dispatch, isStation, ridersFor, transitOptions } from './transit';

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
  /** Time of day: rush hours above 1, night below 1. */
  timeFactor = 1;
  /** Event boosts per workplace id (e.g. a match day). */
  readonly boosts = new Map<number, number>();
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
    this.through(ctx, created);
    // Passengers who arrived at a station get into a bus or taxis.
    for (const b of ctx.buildings) if (isStation(b)) dispatch(b, ctx.time, ctx.nextTripId);
    for (const w of ctx.buildings) {
      if (w.kind !== 'ticari' || !isActive(w, ctx.time)) continue;
      w.pinTimer -= ctx.dt * this.timeFactor * (this.boosts.get(w.id) ?? 1);
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

  /** Seconds between through-traffic cars entering at one gateway. */
  throughInterval(time: number): number {
    return Math.max(THROUGH.intervalMin, THROUGH.interval - THROUGH.decayPerMinute * (time / 60));
  }

  /**
   * Highway traffic. Each gateway regularly sends a car: most pass through
   * to another gateway, some drive into the city (to any house or workplace
   * the player has linked to the highway), and some city cars leave from a
   * linked workplace to this gateway. None of them score or count as pins.
   * When the highway is jammed, cars that cannot even enter are dropped.
   */
  private through(ctx: DemandContext, created: TripRequest[]): void {
    const gates = ctx.buildings.filter((b) => b.kind === 'kapi');
    if (gates.length === 0) return;
    const push = (from: Building, to: Building): void => {
      const trip: TripRequest = {
        id: ctx.nextTripId(),
        origin: from.id,
        destination: to.id,
        createdAt: ctx.time,
      };
      from.pending.push(trip);
      created.push(trip);
    };
    for (const g of gates) {
      g.pinTimer -= ctx.dt * this.timeFactor;
      if (g.pinTimer > 0) continue;
      g.pinTimer += this.throughInterval(ctx.time);
      const roll = ctx.rng.next();
      if (roll < THROUGH.outboundShare) {
        // A car from the city heads out onto the highway.
        const works = ctx.buildings.filter(
          (w) =>
            w.kind === 'ticari' &&
            isActive(w, ctx.time) &&
            w.pending.length < THROUGH.maxOutboundPerWorkplace &&
            ctx.reachable(w, g),
        );
        if (works.length > 0) {
          push(ctx.rng.pick(works), g);
          continue;
        }
      }
      if (g.pending.length >= THROUGH.maxPending) continue;
      if (roll >= THROUGH.outboundShare && roll < THROUGH.outboundShare + THROUGH.inboundShare) {
        // A car from outside comes into the city.
        const city = ctx.buildings.filter(
          (b) => (b.kind === 'ticari' || b.kind === 'konut') && isActive(b, ctx.time) && ctx.reachable(g, b),
        );
        if (city.length > 0) {
          push(g, ctx.rng.pick(city));
          continue;
        }
      }
      const targets = gates.filter((o) => o !== g && ctx.reachable(g, o));
      if (targets.length > 0) push(g, ctx.rng.pick(targets));
    }
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
    // A ferry or metro line: always when no house can drive there, otherwise for a share of the trips.
    const lines = transitOptions(ctx.buildings, w, ctx.reachable, (h) => isActive(h, ctx.time));
    if (lines.length > 0 && (reachable.length === 0 || ctx.rng.next() < TRANSIT.share)) {
      const option = ctx.rng.pick(lines);
      const house = ctx.rng.pick(option.houses);
      const trip: TripRequest = {
        id: ctx.nextTripId(),
        origin: house.id,
        destination: w.id,
        createdAt: ctx.time,
      };
      board(trip, house, option, ctx.time);
      return trip;
    }
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

/**
 * Pins shown on a workplace: trips waiting for a car, people on the way by
 * car, bus or taxi, and passengers riding a ferry or metro towards it.
 */
export function pinsAt(buildings: readonly Building[], workplace: Building): number {
  let n = workplace.incoming;
  for (const b of buildings)
    for (const t of b.pending) if (t.destination === workplace.id) n += t.passengers ?? 1;
  return n + ridersFor(buildings, workplace);
}

/** Fraction (0..1) of the overflow timer that is used up (stored as a fraction). */
export function overflowUsed(b: Building): number {
  return Math.min(1, b.overflow);
}
