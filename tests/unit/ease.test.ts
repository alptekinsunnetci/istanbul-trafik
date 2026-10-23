import { describe, expect, it } from 'vitest';
import { MODES, PLAYFIELD } from '../../src/core/constants';
import { GameSession } from '../../src/gameplay/game-session';
import { doorCell, inBounds } from '../../src/map/map-generator';
import { DIRS, DX, DY, type Dir, Terrain, opposite } from '../../src/map/grid';
import { smoothStroke } from '../../src/map/road-editor';
import { buildingCells } from '../../src/core/world-state';
import { addBuilding, play, testGrid } from '../helpers';
import type { Building } from '../../src/core/world-state';

function cellsOf(s: GameSession, b: Building): number[] {
  return buildingCells(b, s.sim.grid.width);
}

describe('growing playable area', () => {
  it('starts small, keeps buildings inside and grows every week', () => {
    const s = new GameSession({ districtId: 'besiktas', seed: 4 });
    const b = s.bounds;
    expect(b.x1 - b.x0 + 1).toBe(PLAYFIELD.startWidth);
    expect(b.y1 - b.y0 + 1).toBe(PLAYFIELD.startHeight);
    const city = s.sim.buildings.filter((x) => x.kind !== 'kapi');
    for (const x of city) {
      expect(inBounds(b, x.x, x.y)).toBe(true);
      expect(inBounds(b, x.x + x.w - 1, x.y + x.h - 1)).toBe(true);
    }
    s.start();
    play(s, 95);
    expect(s.week).toBe(2);
    expect(s.bounds.x1 - s.bounds.x0).toBeGreaterThan(b.x1 - b.x0);
    for (const x of s.sim.buildings) if (x.kind !== 'kapi') expect(inBounds(s.bounds, x.x, x.y)).toBe(true);
    s.dispose();
  });

  it('stops a road at the edge of the playable area', () => {
    const s = new GameSession({ districtId: 'sisli', seed: 1 });
    const g = s.sim.grid;
    const y = s.bounds.y0 + 1;
    const stroke = [g.idx(s.bounds.x1 - 2, y), g.idx(s.bounds.x1 + 3, y)];
    const r = s.edit('road', stroke);
    expect(r.message).toBe('Şehrin sınırına ulaştın');
    expect(g.isRoad(g.idx(s.bounds.x1, y))).toBe(true);
    expect(g.isRoad(g.idx(s.bounds.x1 + 1, y))).toBe(false);
    s.dispose();
  });
});

describe('snapping and smoothing', () => {
  it('a drag from one building to another connects their doors', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 2026 });
    const work = s.sim.buildings.find((b) => b.kind === 'ticari')!;
    const house = s.sim.buildings.find((b) => b.kind === 'konut')!;
    // Pointer samples: inside the house, then straight towards the workplace, ending inside it.
    const start = cellsOf(s, house)[0]!;
    const end = cellsOf(s, work)[3]!;
    const r = s.edit('road', [start, end]);
    expect(r.changed).toBeGreaterThan(0);
    expect(s.sim.reachable(house, work)).toBe(true);
    s.dispose();
  });

  it('fills fast drags around buildings instead of through them', () => {
    const g = testGrid(20, 20);
    const bs: Building[] = [];
    addBuilding(g, bs, 'ticari', 8, 8, 0);
    const path = smoothStroke(g, [g.idx(5, 9), g.idx(13, 9)]);
    expect(path[0]).toBe(g.idx(5, 9));
    expect(path[path.length - 1]).toBe(g.idx(13, 9));
    for (const c of path) expect(g.building[c]).toBe(-1);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!;
      const b = path[k]!;
      expect(Math.abs(g.cx(a) - g.cx(b)) + Math.abs(g.cy(a) - g.cy(b))).toBe(1);
    }
  });
});

describe('undo', () => {
  it('reverts roads and gives the pieces back', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 2026 });
    const g = s.sim.grid;
    const roadsBefore = g.road.reduce((a, b) => a + b, 0);
    const pieces = s.resources.roads;
    const work = s.sim.buildings.find((b) => b.kind === 'ticari')!;
    const house = s.sim.buildings.find((b) => b.kind === 'konut')!;
    expect(s.canUndo).toBe(false);
    s.edit('road', [cellsOf(s, house)[0]!, cellsOf(s, work)[0]!]);
    expect(s.canUndo).toBe(true);
    expect(s.resources.roads).toBeLessThan(pieces);
    expect(s.undo()).toBe(true);
    expect(g.road.reduce((a, b) => a + b, 0)).toBe(roadsBefore);
    expect(s.resources.roads).toBe(pieces);
    expect(s.sim.reachable(house, work)).toBe(false);
    for (const b of s.sim.buildings) expect(g.isRoad(b.door)).toBe(true);
    expect(s.undo()).toBe(false);
    s.dispose();
  });
});

describe('difficulty modes', () => {
  it('Rahat never ends; Normal and Zor end when a workplace overflows', () => {
    const ends = (mode: 'rahat' | 'normal' | 'zor'): { over: boolean; time: number } => {
      const s = new GameSession({ districtId: 'fatih', seed: 3, mode });
      s.start();
      play(s, 600);
      const r = { over: s.phase === 'over', time: s.sim.time };
      s.dispose();
      return r;
    };
    const rahat = ends('rahat');
    const normal = ends('normal');
    const zor = ends('zor');
    expect(rahat.over).toBe(false);
    expect(normal.over).toBe(true);
    expect(zor.over).toBe(true);
    // Zor is the hardest: it ends first.
    expect(zor.time).toBeLessThan(normal.time);
    expect(MODES.rahat.pinIntervalFactor).toBeGreaterThan(MODES.normal.pinIntervalFactor);
  });
});

describe('portrait screens', () => {
  it('a tall playable area keeps all buildings inside', () => {
    for (const districtId of ['kadikoy', 'fatih', 'bakirkoy']) {
      const s = new GameSession({ districtId, seed: 7, orientation: 'tall' });
      const b = s.bounds;
      expect(b.x1 - b.x0 + 1).toBe(PLAYFIELD.startHeight);
      expect(b.y1 - b.y0 + 1).toBe(PLAYFIELD.startWidth);
      expect(s.sim.buildings.length).toBeGreaterThanOrEqual(4);
      for (const x of s.sim.buildings)
        if (x.kind !== 'kapi') expect(inBounds(b, x.x + x.w - 1, x.y + x.h - 1)).toBe(true);
      s.dispose();
    }
  });
});

describe('entrances turn towards the road', () => {
  /** A free side of the house other than its current entrance, and a cell a few steps out on that side. */
  function otherSide(s: GameSession, house: Building): { dir: Dir; target: number } | null {
    const g = s.sim.grid;
    for (const dir of [opposite(house.doorDir), ...DIRS]) {
      if (dir === house.doorDir) continue;
      const door = doorCell(g, house.kind, house.x, house.y, dir);
      if (door < 0 || g.building[door] !== -1 || g.terrain[door] !== Terrain.Land) continue;
      const tx = g.cx(door) + DX[dir]! * 3;
      const ty = g.cy(door) + DY[dir]! * 3;
      if (!inBounds(s.bounds, tx, ty)) continue;
      const target = g.idx(tx, ty);
      if (g.building[target] !== -1 || g.terrain[target] !== Terrain.Land) continue;
      return { dir, target };
    }
    return null;
  }

  it('an unconnected entrance turns to the side the road leaves from, and undo turns it back', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 2026 });
    const g = s.sim.grid;
    // Pick a house that has a free side to turn to.
    const house = s.sim.buildings.find((b) => b.kind === 'konut' && otherSide(s, b) !== null)!;
    expect(house).toBeDefined();
    const oldDoor = house.door;
    const oldDir = house.doorDir;
    const side = otherSide(s, house)!;
    const r = s.edit('road', [cellsOf(s, house)[0]!, side.target]);
    expect(r.changed).toBeGreaterThan(0);
    expect(house.doorDir).toBe(side.dir);
    expect(house.door).not.toBe(oldDoor);
    expect(g.locked[house.door]).toBe(1);
    expect(g.isRoad(oldDoor)).toBe(false);
    expect(g.locked[oldDoor]).toBe(0);
    expect(g.degree(house.door)).toBeGreaterThan(0);
    expect(s.sim.graph.node(house.door)).toBeDefined();

    expect(s.undo()).toBe(true);
    expect(house.door).toBe(oldDoor);
    expect(house.doorDir).toBe(oldDir);
    expect(g.locked[oldDoor]).toBe(1);
    expect(g.isRoad(oldDoor)).toBe(true);
    s.dispose();
  });

  it('a connected entrance stays where it is', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 2026 });
    const work = s.sim.buildings.find((b) => b.kind === 'ticari')!;
    const house = s.sim.buildings.find((b) => b.kind === 'konut')!;
    s.edit('road', [cellsOf(s, house)[0]!, cellsOf(s, work)[0]!]);
    expect(s.sim.reachable(house, work)).toBe(true);
    const door = house.door;
    const side = otherSide(s, house);
    if (side) s.edit('road', [cellsOf(s, house)[0]!, side.target]);
    expect(house.door).toBe(door);
    expect(s.sim.reachable(house, work)).toBe(true);
    s.dispose();
  });
});
