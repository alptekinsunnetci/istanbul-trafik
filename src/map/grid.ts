/** Cardinal directions in screen space (y grows downwards): N=0, E=1, S=2, W=3. */
export type Dir = 0 | 1 | 2 | 3;

export const DIRS: readonly Dir[] = [0, 1, 2, 3];
export const DX: readonly number[] = [0, 1, 0, -1];
export const DY: readonly number[] = [-1, 0, 1, 0];

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

export function dirBetween(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === 0) return 1;
  if (dx === 0 && dy === 1) return 2;
  if (dx === -1 && dy === 0) return 3;
  return null;
}

export const Terrain = {
  Land: 0,
  Water: 1,
  Park: 2,
} as const;
export type TerrainType = (typeof Terrain)[keyof typeof Terrain];

/**
 * Logical map grid. Roads are stored as cells plus *directed links* between
 * neighbouring cells: bit `d` of `links[i]` means traffic may move from cell
 * `i` to its neighbour in direction `d`. A two-way road has links in both
 * directions, a one-way road in one. Rendering and topology are both derived
 * from these links, so what is drawn is exactly what is connected.
 */
export class Grid {
  readonly width: number;
  readonly height: number;
  readonly terrain: Uint8Array;
  readonly road: Uint8Array;
  readonly links: Uint8Array;
  readonly lanes: Uint8Array;
  /** Door cells of buildings and highway cells cannot be removed by the player. */
  readonly locked: Uint8Array;
  /** Pre-built highway cells (faster, cannot be erased or changed). */
  readonly highway: Uint8Array;
  /** Traffic light on this cell (only effective where it is a junction). */
  readonly signal: Uint8Array;
  readonly building: Int32Array;
  /** Incremented on every road change. */
  version = 0;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4) {
      throw new Error(`Geçersiz harita boyutu: ${width}×${height}`);
    }
    if (width * height > 65536) throw new Error('Harita en fazla 65536 hücre olabilir');
    this.width = width;
    this.height = height;
    const n = width * height;
    this.terrain = new Uint8Array(n);
    this.road = new Uint8Array(n);
    this.links = new Uint8Array(n);
    this.lanes = new Uint8Array(n);
    this.locked = new Uint8Array(n);
    this.highway = new Uint8Array(n);
    this.signal = new Uint8Array(n);
    this.building = new Int32Array(n).fill(-1);
  }

  get size(): number {
    return this.width * this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  cx(i: number): number {
    return i % this.width;
  }

  cy(i: number): number {
    return Math.floor(i / this.width);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Neighbour index in direction d, or -1 outside the map. */
  neighbor(i: number, d: Dir): number {
    const x = this.cx(i) + (DX[d] as number);
    const y = this.cy(i) + (DY[d] as number);
    return this.inBounds(x, y) ? this.idx(x, y) : -1;
  }

  isRoad(i: number): boolean {
    return i >= 0 && i < this.size && this.road[i] === 1;
  }

  hasLink(i: number, d: Dir): boolean {
    return ((this.links[i] as number) & (1 << d)) !== 0;
  }

  /** True when the two cells are joined by a link in at least one direction. */
  connected(i: number, d: Dir): boolean {
    const n = this.neighbor(i, d);
    if (n < 0 || !this.isRoad(i) || !this.isRoad(n)) return false;
    return this.hasLink(i, d) || this.hasLink(n, opposite(d));
  }

  degree(i: number): number {
    let deg = 0;
    for (const d of DIRS) if (this.connected(i, d)) deg++;
    return deg;
  }

  setLink(i: number, d: Dir, on: boolean): void {
    const bit = 1 << d;
    this.links[i] = on ? (this.links[i] as number) | bit : (this.links[i] as number) & ~bit;
  }

  isHighway(i: number): boolean {
    return this.highway[i] === 1;
  }

  isBridge(i: number): boolean {
    return this.terrain[i] === Terrain.Water;
  }

  touch(): void {
    this.version++;
  }
}
