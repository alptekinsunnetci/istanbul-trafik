import type { Graphics } from 'pixi.js';
import { GEOM } from '../core/constants';
import { DIRS, DX, DY, type Dir, type Grid, opposite } from '../map/grid';
import type { Theme } from './theme';

const C = GEOM.cellSize;
const STREET_WIDTH = 8.6;
const BOULEVARD_WIDTH = 14.4;
const HIGHWAY_WIDTH = 16;
/** Kerb radius where a street joins a highway. */
const MOUTH_RADIUS = 4.5;
/** Highways run on past the map edge where they leave the city. */
const OFF_MAP = C * 40;

function center(grid: Grid, i: number): [number, number] {
  return [(grid.cx(i) + 0.5) * C, (grid.cy(i) + 0.5) * C];
}

/**
 * Roads as thick rounded lines between connected cell centres. Only
 * one-way arrows are drawn as markings; bridges get a dark outline.
 * Highways are wider, with a light edge and a dashed centre line, and run
 * on past the map edge at their gateways.
 */
export function drawRoads(g: Graphics, grid: Grid, theme: Theme): void {
  g.clear();
  const streets: [number, number][] = [];
  const boulevards: [number, number][] = [];
  const highways: [number, number][] = [];
  /** Streets joining a highway: [highway cell, street cell, direction from the highway]. */
  const ramps: [number, number, Dir][] = [];
  const bridges: [number, number][] = [];
  const highwayBridges: [number, number][] = [];
  const lone: number[] = [];

  for (let i = 0; i < grid.size; i++) {
    if (!grid.isRoad(i)) continue;
    let connections = 0;
    for (const d of DIRS) {
      if (!grid.connected(i, d)) continue;
      connections++;
      const n = grid.neighbor(i, d);
      if (n < i) continue; // each connection once
      const wide = grid.lanes[i] === 2 && grid.lanes[n] === 2;
      if (grid.isHighway(i) !== grid.isHighway(n)) {
        if (grid.isHighway(i)) ramps.push([i, n, d]);
        else ramps.push([n, i, opposite(d)]);
      }
      if (grid.isHighway(i) && grid.isHighway(n)) highways.push([i, n]);
      else (wide ? boulevards : streets).push([i, n]);
      if (grid.isBridge(i) || grid.isBridge(n))
        (grid.isHighway(i) && grid.isHighway(n) ? highwayBridges : bridges).push([i, n]);
    }
    if (connections === 0) lone.push(i);
  }

  const stroke = (pairs: [number, number][], width: number, color: number): void => {
    if (pairs.length === 0) return;
    for (const [a, b] of pairs) {
      const [ax, ay] = center(grid, a);
      const [bx, by] = center(grid, b);
      g.moveTo(ax, ay).lineTo(bx, by);
    }
    g.stroke({ width, color, cap: 'round', join: 'round' });
  };

  // Highway ends at the map edge: continue the road out of the map.
  const exits: [number, number, number, number][] = [];
  for (let i = 0; i < grid.size; i++) {
    if (!grid.isHighway(i)) continue;
    for (const d of DIRS) {
      const n = grid.neighbor(i, d);
      if (n < 0 || (grid.building[n] as number) < 0) continue;
      const nx = grid.cx(n);
      const ny = grid.cy(n);
      if (nx !== 0 && ny !== 0 && nx !== grid.width - 1 && ny !== grid.height - 1) continue;
      const [x, y] = center(grid, i);
      exits.push([x, y, x + (DX[d] as number) * OFF_MAP, y + (DY[d] as number) * OFF_MAP]);
    }
  }
  const lines = (list: [number, number, number, number][], width: number, color: number): void => {
    if (list.length === 0) return;
    for (const [ax, ay, bx, by] of list) g.moveTo(ax, ay).lineTo(bx, by);
    g.stroke({ width, color, cap: 'butt', join: 'round' });
  };

  stroke(highwayBridges, HIGHWAY_WIDTH + 6, theme.bridgeEdge);
  stroke(bridges, BOULEVARD_WIDTH + 4, theme.bridgeEdge);
  lines(exits, HIGHWAY_WIDTH + 3, theme.highwayEdge);
  stroke(highways, HIGHWAY_WIDTH + 3, theme.highwayEdge);
  lines(exits, HIGHWAY_WIDTH, theme.highway);
  stroke(highways, HIGHWAY_WIDTH, theme.highway);
  stroke(streets, STREET_WIDTH, theme.road);
  stroke(boulevards, BOULEVARD_WIDTH, theme.road);
  // Junction mouths: the street widens into the highway with rounded kerbs,
  // and the white edge line is broken where the street joins.
  for (const [h, n, d] of ramps) {
    const [hx, hy] = center(grid, h);
    const ux = DX[d] as number;
    const uy = DY[d] as number;
    const px = -uy;
    const py = ux;
    const e = HIGHWAY_WIDTH / 2 + 1.5;
    const w = (grid.lanes[n] === 2 ? BOULEVARD_WIDTH : STREET_WIDTH) / 2;
    const r = MOUTH_RADIUS;
    const at = (along: number, side: number): [number, number] => [
      hx + ux * along + px * side,
      hy + uy * along + py * side,
    ];
    const [s1x, s1y] = at(e - 3, w + r + 1);
    const [e1x, e1y] = at(e, w + r);
    const [c1x, c1y] = at(e, w);
    const [t1x, t1y] = at(e + r, w);
    const [t2x, t2y] = at(e + r, -w);
    const [c2x, c2y] = at(e, -w);
    const [e2x, e2y] = at(e, -w - r);
    const [s2x, s2y] = at(e - 3, -w - r - 1);
    g.moveTo(s1x, s1y)
      .lineTo(e1x, e1y)
      .quadraticCurveTo(c1x, c1y, t1x, t1y)
      .lineTo(t2x, t2y)
      .quadraticCurveTo(c2x, c2y, e2x, e2y)
      .lineTo(s2x, s2y)
      .closePath()
      .fill(theme.road);
  }
  // Dashed centre line of the highways.
  const dashes: [number, number, number, number][] = [];
  for (const [a, b] of highways) {
    const [ax, ay] = center(grid, a);
    const [bx, by] = center(grid, b);
    dashes.push([ax + (bx - ax) * 0.3, ay + (by - ay) * 0.3, ax + (bx - ax) * 0.7, ay + (by - ay) * 0.7]);
  }
  for (const [ax, ay, bx, by] of exits) {
    const dx = Math.sign(bx - ax) * C;
    const dy = Math.sign(by - ay) * C;
    for (let k = 0; k < 40; k++)
      dashes.push([ax + dx * (k + 0.3), ay + dy * (k + 0.3), ax + dx * (k + 0.7), ay + dy * (k + 0.7)]);
  }
  lines(dashes, 1.2, theme.highwayEdge);
  for (const i of lone) {
    const [x, y] = center(grid, i);
    g.circle(x, y, (grid.lanes[i] === 2 ? BOULEVARD_WIDTH : STREET_WIDTH) / 2).fill(theme.road);
  }

  // One-way arrows.
  for (let i = 0; i < grid.size; i++) {
    if (!grid.isRoad(i)) continue;
    for (const d of DIRS) {
      if (!grid.connected(i, d) || !grid.hasLink(i, d)) continue;
      const n = grid.neighbor(i, d);
      if (grid.hasLink(n, opposite(d))) continue;
      const [cx, cy] = center(grid, i);
      const dx = DX[d] as number;
      const dy = DY[d] as number;
      const tipX = cx + dx * C * 0.62;
      const tipY = cy + dy * C * 0.62;
      const backX = cx + dx * C * 0.38;
      const backY = cy + dy * C * 0.38;
      const nx = -dy * 1.8;
      const ny = dx * 1.8;
      g.moveTo(backX + nx, backY + ny)
        .lineTo(tipX, tipY)
        .lineTo(backX - nx, backY - ny);
    }
  }
  g.stroke({ width: 1.1, color: theme.marking, alpha: 0.95, cap: 'round', join: 'round' });
}
