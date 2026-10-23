import type { Graphics } from 'pixi.js';
import { GEOM } from '../core/constants';
import { DIRS, DX, DY, type Grid, opposite } from '../map/grid';
import type { Theme } from './theme';

const C = GEOM.cellSize;
const STREET_WIDTH = 8.6;
const BOULEVARD_WIDTH = 14.4;

function center(grid: Grid, i: number): [number, number] {
  return [(grid.cx(i) + 0.5) * C, (grid.cy(i) + 0.5) * C];
}

/**
 * Roads as thick rounded lines between connected cell centres. Only
 * one-way arrows are drawn as markings; bridges get a light outline.
 */
export function drawRoads(g: Graphics, grid: Grid, theme: Theme): void {
  g.clear();
  const streets: [number, number][] = [];
  const boulevards: [number, number][] = [];
  const bridges: [number, number][] = [];
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
      (wide ? boulevards : streets).push([i, n]);
      if (grid.isBridge(i) || grid.isBridge(n)) bridges.push([i, n]);
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

  stroke(bridges, BOULEVARD_WIDTH + 4, theme.bridgeEdge);
  stroke(streets, STREET_WIDTH, theme.road);
  stroke(boulevards, BOULEVARD_WIDTH, theme.road);
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
