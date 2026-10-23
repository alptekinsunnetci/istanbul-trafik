import type { ResourceKind } from '../core/constants';
import { type Dir, type Grid, Terrain, dirBetween, opposite } from './grid';

/** Countable building pieces: one piece per cell. */
export type Resources = Record<ResourceKind, number>;

export function noResources(): Resources {
  return { roads: 0, bridges: 0, boulevards: 0 };
}

export const UNLIMITED: Resources = { roads: 1e9, bridges: 1e9, boulevards: 1e9 };

export interface EditResult {
  ok: boolean;
  /** Pieces used (positive) or returned (negative). */
  spent: Resources;
  changed: number;
  message?: string;
}

export interface PreviewCell {
  cell: number;
  valid: boolean;
}

export interface StrokePreview {
  cells: PreviewCell[];
  spent: Resources;
  message?: string;
}

/** Pieces that a road cell occupies (returned when it is erased). */
export function cellPieces(grid: Grid, i: number): Resources {
  const r = noResources();
  if (!grid.isRoad(i) || grid.locked[i] === 1) return r;
  if (grid.isBridge(i)) r.bridges = 1;
  else r.roads = 1;
  if (grid.lanes[i] === 2) r.boulevards = 1;
  return r;
}

function addTo(a: Resources, b: Resources, sign = 1): void {
  a.roads += sign * b.roads;
  a.bridges += sign * b.bridges;
  a.boulevards += sign * b.boulevards;
}

/**
 * Turns a raw list of pointer cells into a 4-connected path without repeats
 * of the same cell in sequence. Diagonal jumps are filled with an L-shaped step.
 */
export function normalizeStroke(grid: Grid, cells: readonly number[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    if (c < 0 || c >= grid.size) continue;
    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(c);
      continue;
    }
    if (last === c) continue;
    let x = grid.cx(last);
    let y = grid.cy(last);
    const tx = grid.cx(c);
    const ty = grid.cy(c);
    while (x !== tx || y !== ty) {
      if (Math.abs(tx - x) >= Math.abs(ty - y)) x += Math.sign(tx - x);
      else y += Math.sign(ty - y);
      const next = grid.idx(x, y);
      if (out[out.length - 1] !== next) out.push(next);
    }
  }
  return out;
}

function isObstacle(grid: Grid, i: number): boolean {
  return grid.building[i] !== -1 || grid.terrain[i] === Terrain.Park;
}

/** Shortest 4-connected detour around buildings and parks (excluding `from`), or null. */
function detour(grid: Grid, from: number, to: number, maxVisited = 600): number[] | null {
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let qi = 0; qi < queue.length && queue.length < maxVisited; qi++) {
    const c = queue[qi] as number;
    if (c === to) break;
    for (const d of [0, 1, 2, 3] as const) {
      const n = grid.neighbor(c, d);
      if (n < 0 || prev.has(n) || (n !== to && isObstacle(grid, n))) continue;
      prev.set(n, c);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = prev.get(c) as number) path.push(c);
  return path.reverse();
}

/**
 * Like `normalizeStroke`, but when the straight fill between two pointer
 * samples would cut through a building or park, it walks around it instead.
 * This keeps fast or sloppy drags (and touch input) drawing what was meant.
 */
export function smoothStroke(grid: Grid, cells: readonly number[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    if (c < 0 || c >= grid.size) continue;
    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(c);
      continue;
    }
    if (last === c) continue;
    const straight = normalizeStroke(grid, [last, c]).slice(1);
    const blocked = straight.slice(0, -1).some((x) => isObstacle(grid, x));
    const seg = blocked ? (detour(grid, last, c) ?? straight) : straight;
    for (const x of seg) if (out[out.length - 1] !== x) out.push(x);
  }
  return out;
}

function stepDir(grid: Grid, a: number, b: number): Dir | null {
  return dirBetween(grid.cx(b) - grid.cx(a), grid.cy(b) - grid.cy(a));
}

function buildBlockReason(grid: Grid, i: number): string | null {
  if (grid.building[i] !== -1) return 'Binaların üzerine yol yapılamaz';
  if (grid.terrain[i] === Terrain.Park) return 'Parklara yol yapılamaz';
  return null;
}

/**
 * Validates a road stroke. New land cells use a road piece, new water cells
 * use a bridge piece; the stroke is valid up to the first blocked cell.
 */
export function previewBuild(grid: Grid, stroke: readonly number[], budget: Resources): StrokePreview {
  const cells: PreviewCell[] = [];
  const spent = noResources();
  let message: string | undefined;
  let blocked = false;
  for (const c of stroke) {
    if (blocked) {
      cells.push({ cell: c, valid: false });
      continue;
    }
    const reason = buildBlockReason(grid, c);
    const kind: ResourceKind | null = grid.isRoad(c) ? null : grid.isBridge(c) ? 'bridges' : 'roads';
    if (reason) {
      message = reason;
      blocked = true;
    } else if (kind && spent[kind] + 1 > budget[kind]) {
      message = kind === 'bridges' ? 'Köprü parçası kalmadı' : 'Yol parçası kalmadı';
      blocked = true;
    }
    if (!blocked && kind) spent[kind]++;
    cells.push({ cell: c, valid: !blocked });
  }
  return message === undefined ? { cells, spent } : { cells, spent, message };
}

/** Builds the valid prefix of a stroke and connects consecutive cells in both directions. */
export function buildRoad(grid: Grid, stroke: readonly number[], budget: Resources): EditResult {
  const preview = previewBuild(grid, stroke, budget);
  let changed = 0;
  let prev = -1;
  for (const p of preview.cells) {
    if (!p.valid) break;
    const c = p.cell;
    if (!grid.isRoad(c)) {
      grid.road[c] = 1;
      grid.lanes[c] = 1;
      grid.links[c] = 0;
      changed++;
    }
    if (prev >= 0) {
      const d = stepDir(grid, prev, c);
      if (d !== null && !grid.connected(prev, d)) {
        grid.setLink(prev, d, true);
        grid.setLink(c, opposite(d), true);
        changed++;
      }
    }
    prev = c;
  }
  if (changed > 0) grid.touch();
  const result: EditResult = { ok: preview.message === undefined, spent: preview.spent, changed };
  if (preview.message !== undefined) result.message = preview.message;
  return result;
}

export function previewErase(grid: Grid, stroke: readonly number[]): StrokePreview {
  const cells = stroke.map((c) => ({ cell: c, valid: grid.isRoad(c) && grid.locked[c] !== 1 }));
  const spent = noResources();
  for (const c of new Set(stroke)) addTo(spent, cellPieces(grid, c), -1);
  return { cells, spent };
}

export function eraseRoad(grid: Grid, stroke: readonly number[]): EditResult {
  const spent = noResources();
  let changed = 0;
  let lockedHit = false;
  for (const c of new Set(stroke)) {
    if (!grid.isRoad(c)) continue;
    if (grid.locked[c] === 1) {
      lockedHit = true;
      continue;
    }
    addTo(spent, cellPieces(grid, c), -1);
    for (const d of [0, 1, 2, 3] as const) {
      const n = grid.neighbor(c, d);
      if (n >= 0) grid.setLink(n, opposite(d), false);
    }
    grid.links[c] = 0;
    grid.road[c] = 0;
    grid.lanes[c] = 0;
    changed++;
  }
  if (changed > 0) grid.touch();
  const result: EditResult = { ok: changed > 0, spent, changed };
  if (lockedHit) result.message = 'Bina girişleri silinemez';
  else if (changed === 0) result.message = 'Silinecek yol yok';
  return result;
}

/**
 * Upgrades road cells to two-lane boulevards (one boulevard piece per cell),
 * or downgrades them if the stroke starts on a boulevard.
 */
export function setBoulevard(grid: Grid, stroke: readonly number[], budget: Resources): EditResult {
  const roads = [...new Set(stroke)].filter((c) => grid.isRoad(c));
  const spent = noResources();
  if (roads.length === 0)
    return { ok: false, spent, changed: 0, message: 'Bulvarı mevcut bir yolun üstüne çizin' };
  const downgrade = grid.lanes[roads[0] as number] === 2;
  let changed = 0;
  let message: string | undefined;
  for (const c of roads) {
    if (downgrade) {
      if (grid.lanes[c] === 2) {
        spent.boulevards--;
        grid.lanes[c] = 1;
        changed++;
      }
    } else if (grid.lanes[c] === 1) {
      if (spent.boulevards + 1 > budget.boulevards) {
        message = 'Bulvar parçası kalmadı';
        break;
      }
      spent.boulevards++;
      grid.lanes[c] = 2;
      changed++;
    }
  }
  if (changed > 0) grid.touch();
  const result: EditResult = { ok: message === undefined && changed > 0, spent, changed };
  if (message !== undefined) result.message = message;
  else if (changed === 0) result.message = downgrade ? 'Değişiklik yok' : 'Bu yollar zaten bulvar';
  return result;
}

/**
 * Makes connected consecutive cells of the stroke one-way in drawing
 * direction. Drawing again in the same direction restores two-way traffic.
 */
export function toggleOneWay(grid: Grid, stroke: readonly number[]): EditResult {
  const pairs: { a: number; b: number; d: Dir }[] = [];
  for (let k = 1; k < stroke.length; k++) {
    const a = stroke[k - 1] as number;
    const b = stroke[k] as number;
    const d = stepDir(grid, a, b);
    if (d !== null && grid.connected(a, d)) pairs.push({ a, b, d });
  }
  if (pairs.length === 0) {
    return {
      ok: false,
      spent: noResources(),
      changed: 0,
      message: 'Tek yön için bağlı bir yol boyunca sürükleyin',
    };
  }
  const alreadyOneWay = pairs.every((p) => grid.hasLink(p.a, p.d) && !grid.hasLink(p.b, opposite(p.d)));
  for (const p of pairs) {
    grid.setLink(p.a, p.d, true);
    grid.setLink(p.b, opposite(p.d), alreadyOneWay);
  }
  grid.touch();
  return {
    ok: true,
    spent: noResources(),
    changed: pairs.length,
    message: alreadyOneWay ? 'Çift yön' : 'Tek yön',
  };
}
