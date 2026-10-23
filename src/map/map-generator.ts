import { DEMAND, MAP } from '../core/constants';
import type { Random } from '../core/random';
import { BUILDING_TYPES, type Building, type BuildingKind, buildingCells } from '../core/world-state';
import type { District } from './districts';
import { DIRS, type Dir, Grid, Terrain } from './grid';

export function createDistrictGrid(
  district: District,
  width: number = MAP.defaultWidth,
  height: number = MAP.defaultHeight,
): Grid {
  const grid = new Grid(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Terrain functions are authored for 64×64 and scaled to other sizes.
      const tx = (x * MAP.defaultWidth) / width;
      const ty = (y * MAP.defaultHeight) / height;
      grid.terrain[grid.idx(x, y)] = district.terrain(tx, ty, width, height);
    }
  }
  return grid;
}

export interface Site {
  x: number;
  y: number;
  doorDir: Dir;
  door: number;
}

export function doorCell(grid: Grid, kind: BuildingKind, x: number, y: number, d: Dir): number {
  const { w, h } = BUILDING_TYPES[kind];
  let dx: number;
  let dy: number;
  if (d === 0) [dx, dy] = [x + Math.floor((w - 1) / 2), y - 1];
  else if (d === 2) [dx, dy] = [x + Math.floor((w - 1) / 2), y + h];
  else if (d === 3) [dx, dy] = [x - 1, y + Math.floor((h - 1) / 2)];
  else [dx, dy] = [x + w, y + Math.floor((h - 1) / 2)];
  return grid.inBounds(dx, dy) ? grid.idx(dx, dy) : -1;
}

/** Validates a footprint and its door. Returns the door cell or -1. Buildings keep a one-cell gap. */
export function checkSite(grid: Grid, kind: BuildingKind, x: number, y: number, d: Dir): number {
  const { w, h } = BUILDING_TYPES[kind];
  if (x < 1 || y < 1 || x + w > grid.width - 1 || y + h > grid.height - 1) return -1;
  for (let yy = y - 1; yy <= y + h; yy++) {
    for (let xx = x - 1; xx <= x + w; xx++) {
      const i = grid.idx(xx, yy);
      const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
      if (inside) {
        if (grid.terrain[i] !== Terrain.Land || grid.isRoad(i) || grid.building[i] !== -1) return -1;
        continue;
      }
      if (grid.building[i] !== -1 || grid.locked[i] === 1) return -1;
    }
  }
  const door = doorCell(grid, kind, x, y, d);
  if (door < 0) return -1;
  const dx = grid.cx(door);
  const dy = grid.cy(door);
  if (dx < 1 || dy < 1 || dx >= grid.width - 1 || dy >= grid.height - 1) return -1;
  if (grid.terrain[door] !== Terrain.Land || grid.building[door] !== -1 || grid.locked[door] === 1) return -1;
  // A door must not be adjacent to another building's door.
  for (const dd of DIRS) {
    const n = grid.neighbor(door, dd);
    if (n >= 0 && grid.locked[n] === 1) return -1;
  }
  return door;
}

/** Inclusive cell rectangle. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function inBounds(b: Bounds, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

export interface SiteSearch {
  center: [number, number];
  minRadius: number;
  maxRadius: number;
  /** Minimum distance (cells) to other buildings' footprints. */
  minDistance: number;
  attempts?: number;
  /** Keep the footprint and its door inside this rectangle (inclusive cells). */
  bounds?: Bounds;
}

export function findSite(
  grid: Grid,
  buildings: readonly Building[],
  kind: BuildingKind,
  rng: Random,
  search: SiteSearch,
): Site | null {
  const attempts = search.attempts ?? 80;
  for (let a = 0; a < attempts; a++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(search.minRadius, search.maxRadius);
    const x = Math.round(search.center[0] + Math.cos(angle) * r);
    const y = Math.round(search.center[1] + Math.sin(angle) * r);
    const d = rng.pick(DIRS);
    const door = checkSite(grid, kind, x, y, d);
    if (door >= 0 && search.bounds) {
      const { w, h } = BUILDING_TYPES[kind];
      const bb = search.bounds;
      const inside =
        inBounds(bb, x, y) &&
        inBounds(bb, x + w - 1, y + h - 1) &&
        inBounds(bb, grid.cx(door), grid.cy(door));
      if (!inside) continue;
    }
    if (door < 0) continue;
    const tooClose = buildings.some((b) => {
      const gapX = Math.max(0, Math.max(b.x - (x + BUILDING_TYPES[kind].w), x - (b.x + b.w)));
      const gapY = Math.max(0, Math.max(b.y - (y + BUILDING_TYPES[kind].h), y - (b.y + b.h)));
      return Math.max(gapX, gapY) < search.minDistance;
    });
    if (tooClose) continue;
    return { x, y, doorDir: d, door };
  }
  return null;
}

const NAME_SUFFIXES: Record<BuildingKind, readonly string[]> = {
  konut: ['Evleri', 'Sitesi', 'Apartmanı', 'Konakları', 'Lojmanları'],
  ticari: ['Çarşısı', 'Pasajı', 'İş Merkezi', 'Pazarı', 'Ofisleri'],
};

export function buildingName(
  district: District,
  kind: BuildingKind,
  rng: Random,
  used: ReadonlySet<string>,
): string {
  for (let a = 0; a < 20; a++) {
    const name = `${rng.pick(district.neighbourhoods)} ${rng.pick(NAME_SUFFIXES[kind])}`;
    if (!used.has(name)) return name;
  }
  return `${rng.pick(district.neighbourhoods)} ${rng.pick(NAME_SUFFIXES[kind])} ${used.size + 1}`;
}

/** Writes a building into the grid. Its door becomes a locked road cell. */
export function placeBuilding(grid: Grid, b: Building): void {
  for (const c of buildingCells(b, grid.width)) grid.building[c] = b.id;
  if (!grid.isRoad(b.door)) {
    grid.road[b.door] = 1;
    grid.lanes[b.door] = 1;
    grid.links[b.door] = 0;
  }
  grid.locked[b.door] = 1;
  grid.touch();
}

export function makeBuilding(
  id: number,
  kind: BuildingKind,
  color: number,
  site: Site,
  name: string,
  time: number,
): Building {
  const { w, h } = BUILDING_TYPES[kind];
  return {
    id,
    kind,
    color,
    x: site.x,
    y: site.y,
    w,
    h,
    door: site.door,
    doorDir: site.doorDir,
    name,
    createdAt: time,
    pending: [],
    incoming: 0,
    completed: 0,
    failed: 0,
    unreachable: false,
    pinTimer: DEMAND.firstPinDelay,
    overflow: 0,
  };
}

/** Number of houses that start next to the first workplace. */
const START_HOUSES = 4;

/**
 * Starts the city with one workplace of the first colour near the district
 * centre and a few houses around it, leaving room for several routes.
 */
export function generateInitialBuildings(
  grid: Grid,
  district: District,
  rng: Random,
  bounds?: Bounds,
): Building[] {
  const buildings: Building[] = [];
  const used = new Set<string>();
  const scale = grid.width / MAP.defaultWidth;
  const center: [number, number] = [district.center[0] * scale, district.center[1] * scale];
  const place = (
    kind: BuildingKind,
    around: [number, number],
    minR: number,
    maxR: number,
  ): Building | null => {
    let site: Site | null = null;
    for (let grow = 0; grow <= 16 && !site; grow += 4) {
      site = findSite(grid, buildings, kind, rng, {
        center: around,
        minRadius: minR,
        maxRadius: (maxR + grow) * scale,
        minDistance: 3,
        ...(bounds ? { bounds } : {}),
      });
    }
    if (!site) return null;
    const name = buildingName(district, kind, rng, used);
    used.add(name);
    // Starting buildings are active immediately (no grace period).
    const b = makeBuilding(buildings.length, kind, 0, site, name, -1000);
    placeBuilding(grid, b);
    buildings.push(b);
    return b;
  };
  const work = place('ticari', center, 0, 4);
  const anchor: [number, number] = work ? [work.x + 1, work.y + 1] : center;
  for (let i = 0; i < START_HOUSES; i++) place('konut', anchor, 5, 9);
  return buildings;
}
