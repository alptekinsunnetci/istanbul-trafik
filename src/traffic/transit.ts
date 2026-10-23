import { TRANSIT } from '../core/constants';
import type { Building, TripRequest } from '../core/world-state';

/**
 * Ferry and metro lines. A line joins two stations (`durak` buildings). A
 * house within walking distance of one station can send its trips across
 * the line instead of by car: the passenger walks to the station and rides
 * to the other end. There passengers going to the same workplace share a
 * bus (three or more), the others take a taxi each. Waiting and riding
 * passengers still count as pins of their workplace.
 */

/** Cells between two buildings (Chebyshev-free straight distance between their corners). */
export function cellDistance(a: Building, b: Building): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function isStation(b: Building): boolean {
  return b.kind === 'durak' && b.transit !== undefined;
}

/** Seconds a passenger needs from the house, along the line, to the far station. */
export function journeyTime(house: Building, from: Building): number {
  const ride = from.transit?.mode === 'vapur' ? TRANSIT.ferryTime : TRANSIT.metroTime;
  return cellDistance(house, from) * TRANSIT.walkPerCell + ride;
}

export interface TransitOption {
  from: Building;
  to: Building;
  /** Houses of the right colour within walking distance of `from`. */
  houses: Building[];
}

/**
 * Lines a passenger could take to a workplace: the far station must reach
 * the workplace by road (taxis and buses drive the last bit).
 */
export function transitOptions(
  buildings: readonly Building[],
  work: Building,
  canDrive: (from: Building, to: Building) => boolean,
  houseOk: (h: Building) => boolean,
): TransitOption[] {
  const byId = new Map<number, Building>();
  for (const b of buildings) byId.set(b.id, b);
  const out: TransitOption[] = [];
  for (const to of buildings) {
    if (!isStation(to)) continue;
    const from = byId.get(to.transit?.partner ?? -1);
    if (!from || !isStation(from) || !canDrive(to, work)) continue;
    const houses = buildings.filter(
      (h) =>
        h.kind === 'konut' &&
        h.color === work.color &&
        houseOk(h) &&
        cellDistance(h, from) <= TRANSIT.walkRadius,
    );
    if (houses.length > 0) out.push({ from, to, houses });
  }
  return out;
}

/**
 * Puts a passenger on a line. Ferries and metros run to a timetable, so
 * everyone on board gets off together at the next arrival after the walk
 * and the ride; that is what fills a bus at the far station.
 */
export function board(trip: TripRequest, house: Building, option: TransitOption, time: number): void {
  const every = option.from.transit?.mode === 'vapur' ? TRANSIT.ferryEvery : TRANSIT.metroEvery;
  const arrival = Math.ceil((time + journeyTime(house, option.from)) / every) * every;
  option.to.transit?.riders.push({ trip, readyAt: arrival });
}

/**
 * Passengers who arrived at a station get into vehicles: groups of three or
 * more going to the same workplace share a bus (up to its capacity), the
 * others take a taxi each. Returns the number of vehicles queued.
 */
export function dispatch(station: Building, time: number, nextTripId: () => number): number {
  const t = station.transit;
  if (!t || t.riders.length === 0) return 0;
  const ready = t.riders.filter((r) => r.readyAt <= time);
  if (ready.length === 0) return 0;
  t.riders = t.riders.filter((r) => r.readyAt > time);
  const byDest = new Map<number, TripRequest[]>();
  for (const r of ready) {
    const list = byDest.get(r.trip.destination) ?? [];
    list.push(r.trip);
    byDest.set(r.trip.destination, list);
  }
  let queued = 0;
  for (const [destination, trips] of byDest) {
    let rest = trips;
    while (rest.length >= TRANSIT.busMin) {
      const group = rest.slice(0, TRANSIT.busCapacity);
      rest = rest.slice(group.length);
      station.pending.push({
        id: nextTripId(),
        origin: station.id,
        destination,
        createdAt: time,
        passengers: group.length,
        kind: 'otobus',
      });
      queued++;
    }
    for (const trip of rest) {
      station.pending.push({ ...trip, origin: station.id, createdAt: time, passengers: 1, kind: 'taxi' });
      queued++;
    }
  }
  return queued;
}

/** Passengers riding towards (or waiting at) stations for a workplace. */
export function ridersFor(buildings: readonly Building[], work: Building): number {
  let n = 0;
  for (const b of buildings) {
    for (const r of b.transit?.riders ?? []) if (r.trip.destination === work.id) n += r.trip.passengers ?? 1;
  }
  return n;
}
