import { describe, expect, it } from 'vitest';
import { TRANSIT } from '../../src/core/constants';
import type { Building } from '../../src/core/world-state';
import { GameSession } from '../../src/gameplay/game-session';
import { Terrain } from '../../src/map/grid';
import { makeBuilding, placeBuilding } from '../../src/map/map-generator';
import { pinsAt } from '../../src/traffic/demand-generator';
import { dispatch } from '../../src/traffic/transit';
import { addBuilding, makeSim, road, runFor, testGrid } from '../helpers';

/** A line between two stations placed by hand. */
function station(
  g: ReturnType<typeof testGrid>,
  list: Building[],
  x: number,
  y: number,
  partner: number,
): Building {
  const b = makeBuilding(
    list.length,
    'durak',
    0,
    { x, y, doorDir: 1, door: g.idx(x + 1, y) },
    `Durak ${x}`,
    -1000,
  );
  b.transit = { mode: 'metro', partner, riders: [] };
  placeBuilding(g, b);
  list.push(b);
  return b;
}

describe('ferry and metro lines', () => {
  it('a house with no road reaches its workplace by metro, then by taxi or bus', () => {
    const g = testGrid(40, 30);
    const b: Building[] = [];
    const work = addBuilding(g, b, 'ticari', 30, 14, 3);
    // Houses far away with no road at all, next to station A.
    const houses = [
      addBuilding(g, b, 'konut', 3, 4, 1),
      addBuilding(g, b, 'konut', 3, 8, 1),
      addBuilding(g, b, 'konut', 3, 12, 1),
    ];
    const a = station(g, b, 6, 6, b.length + 1);
    const far = station(g, b, 22, 14, a.id);
    // Station B is linked to the workplace by road; station A needs no road.
    road(g, [23, 14], [29, 14]);
    // Real demand: the workplace asks for trips by itself.
    const sim = makeSim(g, b, 1, true);
    let byLine = 0;
    let buses = 0;
    let taxis = 0;
    sim.events.on('vehicleSpawned', (v) => {
      if (v.origin !== far.id) return;
      if (v.kind === 'otobus') buses++;
      if (v.kind === 'taxi') taxis++;
    });
    sim.events.on('tripCompleted', (e) => {
      if (e.vehicle.origin === far.id) byLine += e.vehicle.passengers;
    });
    let pinsSeen = 0;
    runFor(sim, 400, () => {
      pinsSeen = Math.max(pinsSeen, pinsAt(sim.buildings, work));
    });
    expect(houses.every((h) => !sim.reachable(h, work))).toBe(true);
    expect(byLine).toBeGreaterThan(10);
    expect(taxis + buses).toBeGreaterThan(0);
    // Every passenger who arrived is counted, a bus counts all of its people.
    expect(sim.stats.completed).toBe(byLine);
    expect(pinsSeen).toBeGreaterThan(0);
  });

  it('three or more passengers for the same workplace share a bus', () => {
    const g = testGrid(20, 20);
    const b: Building[] = [];
    const work = addBuilding(g, b, 'ticari', 14, 8, 3);
    const st = station(g, b, 4, 8, 99);
    const trip = (id: number) => ({ id, origin: 0, destination: work.id, createdAt: 0 });
    st.transit!.riders.push(...[1, 2, 3, 4].map((id) => ({ trip: trip(id), readyAt: 10 })), {
      trip: { ...trip(5), destination: 77 },
      readyAt: 10,
    });
    let id = 100;
    expect(dispatch(st, 10, () => id++)).toBe(2);
    const bus = st.pending.find((t) => t.kind === 'otobus')!;
    expect(bus.passengers).toBe(4);
    expect(st.pending.find((t) => t.kind === 'taxi')!.destination).toBe(77);
    expect(st.transit!.riders).toHaveLength(0);
    expect(TRANSIT.busMin).toBeLessThanOrEqual(4);
  });

  it('the line tool builds a ferry across the Boğaz and a metro over land, and removes them again', () => {
    const s = new GameSession({ districtId: 'beyoglu', seed: 3 });
    const g = s.sim.grid;
    s.bounds = { x0: 0, y0: 0, x1: g.width - 1, y1: g.height - 1 };
    s.resources.lines = 2;
    // From the European shore across the Boğaz to Üsküdar.
    const row = 20;
    let shoreW = -1;
    let shoreE = -1;
    for (let x = 1; x < g.width - 1; x++) {
      const here = g.terrain[g.idx(x, row)];
      const next = g.terrain[g.idx(x + 1, row)];
      if (here === Terrain.Land && next === Terrain.Water && shoreW < 0) shoreW = x;
      if (here === Terrain.Water && next === Terrain.Land) shoreE = x + 1;
    }
    const ferry = s.edit('transit', [g.idx(shoreW, row), g.idx(shoreE, row)]);
    expect(ferry.ok, ferry.message).toBe(true);
    const piers = s.sim.buildings.filter((x) => x.kind === 'durak');
    expect(piers).toHaveLength(2);
    expect(piers.every((p) => p.transit?.mode === 'vapur')).toBe(true);
    expect(s.resources.lines).toBe(1);
    const metro = s.edit('transit', [g.idx(10, 20), g.idx(25, 25)]);
    expect(metro.ok, metro.message).toBe(true);
    expect(s.sim.buildings.filter((x) => x.transit?.mode === 'metro')).toHaveLength(2);
    // Tapping a station removes its line and returns the piece.
    const off = s.edit('transit', [piers[0]!.door === -1 ? 0 : g.idx(piers[0]!.x, piers[0]!.y)]);
    expect(off.ok).toBe(true);
    expect(s.sim.buildings.filter((x) => x.kind === 'durak')).toHaveLength(2);
    expect(s.resources.lines).toBe(1);
    s.dispose();
  });

  it('removing a line sends every passenger back home to drive instead', () => {
    const s = new GameSession({ districtId: 'beyoglu', seed: 3 });
    const g = s.sim.grid;
    s.bounds = { x0: 0, y0: 0, x1: g.width - 1, y1: g.height - 1 };
    expect(s.edit('transit', [g.idx(10, 20), g.idx(25, 25)]).ok).toBe(true);
    const [a, b] = s.sim.buildings.filter((x) => x.kind === 'durak') as [Building, Building];
    const house = s.sim.buildings.find((x) => x.kind === 'konut')!;
    const work = s.sim.buildings.find((x) => x.kind === 'ticari')!;
    const before = house.pending.length;
    b.transit!.riders.push({
      trip: { id: 1, origin: house.id, destination: work.id, createdAt: 0 },
      readyAt: 99,
    });
    b.pending.push({
      id: 2,
      origin: b.id,
      destination: work.id,
      createdAt: 0,
      passengers: 3,
      kind: 'otobus',
      homes: [house.id, house.id, house.id],
    });
    const pinsBefore = pinsAt(s.sim.buildings, work);
    expect(s.edit('transit', [g.idx(a.x, a.y)]).ok).toBe(true);
    expect(house.pending.length).toBe(before + 4);
    // Nobody disappears: the workplace still waits for the same number of people.
    expect(pinsAt(s.sim.buildings, work)).toBe(pinsBefore);
    s.dispose();
  });
});
