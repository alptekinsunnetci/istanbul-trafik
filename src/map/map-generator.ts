import { DEMAND, MAP, THROUGH } from '../core/constants';
import type { Random } from '../core/random';
import { BUILDING_TYPES, type Building, type BuildingKind, buildingCells } from '../core/world-state';
import type { District } from './districts';
import { DIRS, type Dir, Grid, Terrain, dirBetween, opposite } from './grid';

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
  for (const hw of highwayPaths(grid, district)) {
    const cells = hw.cells.filter((c) => !hw.gateways.includes(c));
    for (const c of cells) {
      grid.road[c] = 1;
      grid.lanes[c] = 2;
      grid.locked[c] = 1;
      grid.highway[c] = 1;
    }
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1] as number;
      const b = cells[k] as number;
      const d = dirBetween(grid.cx(b) - grid.cx(a), grid.cy(b) - grid.cy(a));
      if (d === null) continue;
      grid.setLink(a, d, true);
      grid.setLink(b, opposite(d), true);
    }
  }
  return grid;
}

export interface HighwayPath {
  name: string;
  /** Cells along the highway, in order, including both ends. */
  cells: number[];
  /** Ends on the map edge; they hold the gateway buildings, not road. */
  gateways: number[];
}

/** The district's highways as cell paths on this grid (authoring coordinates are scaled). */
export function highwayPaths(grid: Grid, district: District): HighwayPath[] {
  const sx = grid.width / MAP.defaultWidth;
  const sy = grid.height / MAP.defaultHeight;
  const out: HighwayPath[] = [];
  for (const hw of district.highways) {
    const pts = hw.path.map(
      ([x, y]) =>
        [
          Math.min(grid.width - 1, Math.round(x * sx)),
          Math.min(grid.height - 1, Math.round(y * sy)),
        ] as const,
    );
    const cells: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      const [x1, y1] = pts[k] as readonly [number, number];
      if (k === 0) {
        cells.push(grid.idx(x1, y1));
        continue;
      }
      let [x, y] = pts[k - 1] as readonly [number, number];
      while (x !== x1 || y !== y1) {
        if (x !== x1) x += Math.sign(x1 - x);
        else y += Math.sign(y1 - y);
        cells.push(grid.idx(x, y));
      }
    }
    const onEdge = (c: number): boolean => {
      const x = grid.cx(c);
      const y = grid.cy(c);
      return x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1;
    };
    const ends = [cells[0] as number, cells[cells.length - 1] as number];
    out.push({ name: hw.name, cells, gateways: ends.filter(onEdge) });
  }
  return out;
}

const SIDE_NAMES = ['kuzey', 'doğu', 'güney', 'batı'] as const;

/**
 * Gateway buildings at the highway ends on the map edge: through traffic
 * enters and leaves the city there.
 */
function placeGateways(grid: Grid, district: District, buildings: Building[]): void {
  let index = 0;
  for (const hw of highwayPaths(grid, district)) {
    for (const g of hw.gateways) {
      const k = hw.cells.indexOf(g);
      const door = hw.cells[k === 0 ? 1 : k - 1];
      if (door === undefined) continue;
      const doorDir = dirBetween(grid.cx(door) - grid.cx(g), grid.cy(door) - grid.cy(g));
      if (doorDir === null) continue;
      // The gateway faces into the city, so it lies on the side opposite to its door.
      const side = SIDE_NAMES[opposite(doorDir)];
      const b = makeBuilding(
        buildings.length,
        'kapi',
        index,
        { x: grid.cx(g), y: grid.cy(g), doorDir, door },
        `${hw.name} · ${side}`,
        -1000,
      );
      b.pinTimer = THROUGH.firstDelay + index * 1.3;
      placeBuilding(grid, b);
      buildings.push(b);
      index++;
    }
  }
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
  /** Extra condition on the top-left cell of the footprint. */
  accept?: (x: number, y: number) => boolean;
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
    if (search.accept && !search.accept(x, y)) continue;
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

/**
 * Numbers the separate pieces of dry ground (4-connected land and park
 * cells); water cells get -1. Two cells with different numbers can only be
 * joined by a bridge.
 */
export function landRegions(grid: Grid): Int32Array {
  const region = new Int32Array(grid.size).fill(-1);
  let next = 0;
  for (let start = 0; start < grid.size; start++) {
    if (region[start] !== -1 || grid.terrain[start] === Terrain.Water) continue;
    const stack = [start];
    region[start] = next;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      for (const d of DIRS) {
        const n = grid.neighbor(c, d);
        if (n < 0 || region[n] !== -1 || grid.terrain[n] === Terrain.Water) continue;
        region[n] = next;
        stack.push(n);
      }
    }
    next++;
  }
  return region;
}

const NAME_SUFFIXES: Record<BuildingKind, readonly string[]> = {
  konut: ['Evleri', 'Sitesi', 'Apartmanı', 'Konakları', 'Lojmanları'],
  ticari: ['Çarşısı', 'Pasajı', 'İş Merkezi', 'Pazarı', 'Ofisleri'],
  kapi: ['Bağlantısı'],
  durak: ['İskelesi', 'İstasyonu'],
  otopark: ['Otoparkı'],
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
 * centre and a few houses around it, leaving room for several routes. The
 * gateways of the district's highways come last.
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
  const regions = landRegions(grid);
  // The first neighbourhood stands on one bank: bridges only matter once the city grows.
  let home = -1;
  const sameBank = (x: number, y: number): boolean => home < 0 || regions[grid.idx(x, y)] === home;
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
        accept: sameBank,
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
  if (work) home = regions[grid.idx(work.x, work.y)] as number;
  const anchor: [number, number] = work ? [work.x + 1, work.y + 1] : center;
  for (let i = 0; i < START_HOUSES; i++) place('konut', anchor, 5, 9);
  placeGateways(grid, district, buildings);
  return buildings;
}
