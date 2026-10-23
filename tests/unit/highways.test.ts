import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../src/map/districts';
import { createDistrictGrid, highwayPaths, inBounds, landRegions } from '../../src/map/map-generator';
import { GameSession } from '../../src/gameplay/game-session';
import { placeHighwaySigns } from '../../src/rendering/map-renderer';
import { cellPath, play } from '../helpers';
import { restoreSession, toSnapshot } from '../../src/gameplay/snapshot';
import { parseSavedGame } from '../../src/persistence/save-schema';
import { migrateSave } from '../../src/persistence/migrations';

describe('highways', () => {
  it('every district has a pre-built, connected highway with gateways on the map edge', () => {
    for (const d of DISTRICTS) {
      const s = new GameSession({ districtId: d.id, seed: 1 });
      const g = s.sim.grid;
      const paths = highwayPaths(g, d);
      expect(paths.length, d.name).toBeGreaterThan(0);
      for (const p of paths) {
        for (const c of p.cells) {
          if (p.gateways.includes(c)) continue;
          expect(g.isHighway(c)).toBe(true);
          expect(g.isRoad(c)).toBe(true);
          expect(g.lanes[c]).toBe(2);
          expect(g.locked[c]).toBe(1);
          expect(g.degree(c)).toBeGreaterThan(0);
        }
      }
      const gates = s.sim.buildings.filter((b) => b.kind === 'kapi');
      expect(gates.length, d.name).toBeGreaterThanOrEqual(2);
      // Every gateway can reach every other one along the highways.
      for (const a of gates) for (const b of gates) if (a !== b) expect(s.sim.reachable(a, b)).toBe(true);
      s.dispose();
    }
  });

  it('cannot be erased, narrowed or made one-way by the player', () => {
    const s = new GameSession({ districtId: 'sisli', seed: 1 });
    const g = s.sim.grid;
    const inside = highwayPaths(g, s.district)[0]!.cells.filter((c) => inBounds(s.bounds, g.cx(c), g.cy(c)));
    const cells = inside.slice(2, 6);
    const erase = s.edit('erase', cells);
    expect(erase.message).toBe('Otoyol silinemez');
    for (const c of cells) expect(g.isRoad(c)).toBe(true);
    s.edit('boulevard', cells);
    for (const c of cells) expect(g.lanes[c]).toBe(2);
    s.edit('oneway', cells);
    for (const c of cells) expect(g.degree(c)).toBe(2);
    expect(
      s.sim.reachable(
        s.sim.buildings.find((b) => b.kind === 'kapi')!,
        s.sim.buildings.at(-1)!,
      ),
    ).toBe(true);
    s.dispose();
  });

  it('carries through traffic that scores nothing', () => {
    const s = new GameSession({ districtId: 'sisli', seed: 2 });
    s.start();
    play(s, 120);
    expect(s.sim.throughCompleted).toBeGreaterThan(10);
    // No house was connected, so the player's own statistics stay empty.
    expect(s.sim.stats.completed).toBe(0);
    expect(s.sim.stats.spawned).toBe(0);
    expect(s.score.score).toBe(0);
    s.dispose();
  });

  it('local roads can join a highway and use it', () => {
    const s = new GameSession({ districtId: 'bakirkoy', seed: 5 });
    const g = s.sim.grid;
    const hw = highwayPaths(g, s.district)[0]!;
    const work = s.sim.buildings.find((b) => b.kind === 'ticari')!;
    // A street from the workplace entrance to the nearest highway cell inside the playable area.
    const inside = hw.cells.filter((c) => inBounds(s.bounds, g.cx(c), g.cy(c)));
    const near = inside.reduce((a, c) =>
      Math.abs(g.cx(c) - g.cx(work.door)) < Math.abs(g.cx(a) - g.cx(work.door)) ? c : a,
    );
    const stroke = [work.door, near];
    const r = s.edit('road', stroke);
    expect(r.changed).toBeGreaterThan(0);
    const gate = s.sim.buildings.find((b) => b.kind === 'kapi')!;
    expect(s.sim.reachable(gate, work)).toBe(true);
    s.dispose();
  });

  it('cars come into the city from the highway and leave onto it, without touching pins or score', () => {
    const s = new GameSession({ districtId: 'bakirkoy', seed: 5, mode: 'rahat' });
    const g = s.sim.grid;
    const hw = highwayPaths(g, s.district)[0]!;
    const work = s.sim.buildings.find((b) => b.kind === 'ticari')!;
    const inside = hw.cells.filter((c) => inBounds(s.bounds, g.cx(c), g.cy(c)));
    const near = inside.reduce((a, c) =>
      Math.abs(g.cx(c) - g.cx(work.door)) < Math.abs(g.cx(a) - g.cx(work.door)) ? c : a,
    );
    s.edit('road', [work.door, near]);
    s.start();
    let inbound = 0;
    let outbound = 0;
    s.sim.events.on('vehicleSpawned', (v) => {
      const from = s.sim.buildingById(v.origin)!;
      const to = s.sim.buildingById(v.destination)!;
      if (from.kind === 'kapi' && to.kind !== 'kapi') inbound++;
      if (from.kind !== 'kapi' && to.kind === 'kapi') outbound++;
    });
    play(s, 240, () => {
      // Pins only count the player's own cars heading to the workplace.
      const own = s.sim.vehicles.filter((v) => v.destination === work.id && !s.sim.highwayTrip(v)).length;
      expect(work.incoming).toBe(own);
    });
    expect(inbound).toBeGreaterThan(0);
    expect(outbound).toBeGreaterThan(0);
    expect(s.score.score).toBe(s.sim.stats.completed);
    s.dispose();
  });

  it('a game with highways and a gateway over water saves and loads', () => {
    const s = new GameSession({ districtId: 'uskudar', seed: 99 });
    s.start();
    const b = s.sim.buildings;
    s.edit('road', cellPath(s.sim.grid, b[0]!.door, b[1]!.door));
    play(s, 30);
    const back = restoreSession(parseSavedGame(migrateSave(JSON.parse(JSON.stringify(toSnapshot(s))))));
    expect(back.sim.buildings.filter((x) => x.kind === 'kapi')).toHaveLength(2);
    expect(back.sim.grid.highway.reduce((a, x) => a + x, 0)).toBe(
      s.sim.grid.highway.reduce((a, x) => a + x, 0),
    );
    back.dispose();
    s.dispose();
  });

  it('a name sign stands on a straight stretch inside the playable area', () => {
    const d = DISTRICTS.find((x) => x.id === 'sisli')!;
    const g = createDistrictGrid(d);
    const signs = placeHighwaySigns(g, d, { x0: 0, y0: 0, x1: g.width - 1, y1: g.height - 1 });
    expect(signs.map((x) => x.text).sort()).toEqual(['BÜYÜKDERE CD.', 'D-100']);
  });
});

describe('bridges', () => {
  it('districts without water never offer bridges', () => {
    const s = new GameSession({ districtId: 'sisli', seed: 3, mode: 'rahat' });
    expect(s.hasWater).toBe(false);
    expect(s.resources.bridges).toBe(0);
    s.start();
    let offered = false;
    s.events.on('upgrade', (u) => {
      if (u.some((x) => x.kind === 'bridges')) offered = true;
    });
    play(s, 500);
    expect(offered).toBe(false);
    s.dispose();
  });

  it('water districts have dry ground on both sides of a river or channel', () => {
    for (const id of ['kadikoy', 'fatih', 'bakirkoy', 'besiktas']) {
      const d = DISTRICTS.find((x) => x.id === id)!;
      const g = createDistrictGrid(d);
      const regions = new Set(landRegions(g).filter((r) => r >= 0));
      expect(regions.size, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('the city grows across the water so bridges are needed', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 4, mode: 'rahat' });
    const g = s.sim.grid;
    const regions = landRegions(g);
    s.start();
    play(s, 700);
    const city = s.sim.buildings.filter((b) => b.kind !== 'kapi');
    const sides = new Set(city.map((b) => regions[g.idx(b.x, b.y)]));
    expect(sides.size).toBeGreaterThanOrEqual(2);
    s.dispose();
  });
});
