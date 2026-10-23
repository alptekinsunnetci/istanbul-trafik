import type { Dir } from '../map/grid';

/**
 * Houses send cars; workplaces receive them. Both carry a colour group.
 * Gateways (`kapi`) sit at the map edge where a highway leaves the city;
 * they send and receive through traffic, and their `color` is only an index.
 */
export type BuildingKind = 'konut' | 'ticari' | 'kapi';

export interface BuildingType {
  w: number;
  h: number;
  label: string;
}

export const BUILDING_TYPES: Record<BuildingKind, BuildingType> = {
  konut: { w: 1, h: 1, label: 'Ev' },
  ticari: { w: 2, h: 2, label: 'İş yeri' },
  kapi: { w: 1, h: 1, label: 'Şehir dışı bağlantısı' },
};

/** Names of the colour groups, in the order they are introduced. */
export const COLOR_NAMES: readonly string[] = ['Mercan', 'Turkuaz', 'Sarı', 'Mor', 'Yeşil'];

export interface TripRequest {
  id: number;
  origin: number;
  destination: number;
  createdAt: number;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  /** Colour group: cars only travel between houses and workplaces of the same colour. */
  color: number;
  /** Top-left cell of the footprint. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Door (access) cell index: a locked road cell adjacent to the footprint. */
  door: number;
  doorDir: Dir;
  name: string;
  createdAt: number;
  /** Houses: trips waiting for a car to depart. */
  pending: TripRequest[];
  /** Active vehicles heading to this building. */
  incoming: number;
  completed: number;
  failed: number;
  /** Houses: set when the last route search to a destination failed. */
  unreachable: boolean;
  /** Workplaces: seconds until the next pin. */
  pinTimer: number;
  /** Workplaces: overflow timer as a fraction 0..1; the game is lost when it is full. */
  overflow: number;
}

/**
 * Highway traffic (to, from or through a gateway): it uses the roads but is
 * not one of the player's trips, so it never counts for pins or the score.
 */
export function isHighwayTrip(origin: Building | undefined, destination: Building | undefined): boolean {
  return origin?.kind === 'kapi' || destination?.kind === 'kapi';
}

export function buildingCells(b: Pick<Building, 'x' | 'y' | 'w' | 'h'>, width: number): number[] {
  const out: number[] = [];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) out.push(y * width + x);
  return out;
}

export type TripFailureReason = 'noRoute' | 'roadRemoved';

export const FAILURE_LABELS: Record<TripFailureReason, string> = {
  noRoute: 'Araç hedefine yol bulamadı',
  roadRemoved: 'Araç silinen bir yoldaydı',
};
