import { describe, expect, it } from 'vitest';
import type { Building } from '../../src/core/world-state';
import { GameSession } from '../../src/gameplay/game-session';
import { makeBuilding, placeBuilding } from '../../src/map/map-generator';
import { addBuilding, addTrip, makeSim, road, runFor, testGrid } from '../helpers';

describe('car parks', () => {
  it('give a workplace a second entrance: cars use whichever is cheaper, and still count for it', () => {
    const g = testGrid(30, 20);
    const b: Building[] = [];
    const home = addBuilding(g, b, 'konut', 2, 4, 1);
    // The workplace door faces east, far from the house; a car park sits on its west side.
    const work = addBuilding(g, b, 'ticari', 20, 4, 1);
    const lot = makeBuilding(
      b.length,
      'otopark',
      0,
      { x: 18, y: 4, doorDir: 3, door: g.idx(17, 4) },
      'Otopark',
      -1000,
    );
    lot.parkingFor = work.id;
    placeBuilding(g, lot);
    b.push(lot);
    // Only the car park entrance is connected to the house.
    road(g, [3, 4], [17, 4]);
    const sim = makeSim(g, b);
    expect(sim.reachable(home, work)).toBe(true);
    addTrip(sim, home, work, 4);
    const doors = new Set<number>();
    sim.events.on('vehicleSpawned', (v) => doors.add(v.destDoor));
    runFor(sim, 120);
    expect(sim.stats.completed).toBe(4);
    expect([...doors]).toEqual([lot.door]);
    expect(work.completed).toBe(4);
  });

  it('the tool puts a car park next to a workplace and takes it away again', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 4 });
    const g = s.sim.grid;
    const work = s.sim.buildings.find((x) => x.kind === 'ticari')!;
    const r = s.edit('parking', [g.idx(work.x, work.y)]);
    expect(r.ok, r.message).toBe(true);
    const lot = s.sim.buildings.find((x) => x.kind === 'otopark')!;
    expect(lot.parkingFor).toBe(work.id);
    expect(Math.hypot(lot.x - work.x, lot.y - work.y)).toBeLessThan(4);
    expect(s.resources.parkings).toBe(0);
    expect(s.edit('parking', [g.idx(lot.x, lot.y)]).ok).toBe(true);
    expect(s.sim.buildings.some((x) => x.kind === 'otopark')).toBe(false);
    expect(s.resources.parkings).toBe(1);
    s.dispose();
  });
});
