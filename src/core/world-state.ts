import type { VehicleKind } from './constants';
import type { Dir } from '../map/grid';
import { L } from './i18n';

/**
 * Houses send cars; workplaces receive them. Both carry a colour group.
 * Gateways (`kapi`) sit at the map edge where a highway leaves the city;
 * they send and receive through traffic, and their `color` is only an index.
 */
export type BuildingKind = 'konut' | 'ticari' | 'kapi' | 'durak' | 'otopark';

export interface BuildingType {
  w: number;
  h: number;
  label: string;
}

export const BUILDING_TYPES: Record<BuildingKind, BuildingType> = {
  konut: { w: 1, h: 1, label: L('Ev', 'House') },
  ticari: { w: 2, h: 2, label: L('İş yeri', 'Workplace') },
  kapi: { w: 1, h: 1, label: L('Şehir dışı bağlantısı', 'Highway exit') },
  durak: { w: 1, h: 1, label: L('Durak', 'Station') },
  otopark: { w: 1, h: 1, label: L('Otopark', 'Car park') },
};

/** Names of the colour groups, in the order they are introduced. */
export const COLOR_NAMES: readonly string[] = [
  L('Mercan', 'Coral'),
  L('Turkuaz', 'Turquoise'),
  L('Sarı', 'Yellow'),
  L('Mor', 'Purple'),
  L('Yeşil', 'Green'),
];

export interface TripRequest {
  id: number;
  origin: number;
  destination: number;
  createdAt: number;
  /** People in the vehicle (a bus carries several); 1 when not set. */
  passengers?: number;
  /** Vehicle to send (taxi or bus from a station); random when not set. */
  kind?: VehicleKind;
  /** Taxi or bus from a station: the houses its passengers came from. */
  homes?: number[];
}

export type TransitMode = 'vapur' | 'metro';

/** A passenger on a line, arriving at the station at `readyAt`. */
export interface TransitRider {
  trip: TripRequest;
  readyAt: number;
}

export interface TransitStation {
  mode: TransitMode;
  /** The station at the other end of the line. */
  partner: number;
  riders: TransitRider[];
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
  /** Ferry pier or metro station (`durak`). */
  transit?: TransitStation;
  /** Car park (`otopark`): the workplace it is a second entrance of. */
  parkingFor?: number;
}

/** Every entrance of a building: its own door, plus the doors of its car parks. */
export function doorsOf(b: Building, all: readonly Building[]): number[] {
  const doors = [b.door];
  if (b.kind === 'ticari') for (const p of all) if (p.parkingFor === b.id) doors.push(p.door);
  return doors;
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
  noRoute: L('Araç hedefine yol bulamadı', 'The vehicle found no road to its destination'),
  roadRemoved: L('Araç silinen bir yoldaydı', 'The vehicle was on a road that was erased'),
};
