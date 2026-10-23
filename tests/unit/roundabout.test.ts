import { describe, expect, it } from 'vitest';
import { JUNCTION, ROUNDABOUT } from '../../src/core/constants';
import type { Building } from '../../src/core/world-state';
import { UNLIMITED, eraseRoad, noResources, toggleRoundabout, toggleSignal } from '../../src/map/road-editor';
import { addBuilding, addTrip, assertNoOverlap, makeSim, road, runFor, testGrid } from '../helpers';

function crossing(withRoundabout: boolean, trips: number) {
  const g = testGrid(30, 30);
  const b: Building[] = [];
  const west = addBuilding(g, b, 'konut', 2, 14, 1);
  const north = addBuilding(g, b, 'konut', 14, 2, 2);
  const east = addBuilding(g, b, 'ticari', 26, 14, 3);
  const south = addBuilding(g, b, 'ticari', 14, 26, 0);
  road(g, [3, 14], [25, 14]);
  road(g, [14, 3], [14, 25]);
  const centre = g.idx(14, 14);
  if (withRoundabout) expect(toggleRoundabout(g, [centre], UNLIMITED).ok).toBe(true);
  const sim = makeSim(g, b);
  addTrip(sim, west, east, trips);
  addTrip(sim, north, south, trips);
  return { g, sim, centre };
}

describe('roundabouts', () => {
  it('go only on junctions, never together with a light, and give their piece back', () => {
    const g = testGrid(20, 20);
    road(g, [2, 10], [17, 10]);
    road(g, [10, 2], [10, 10]);
    const c = g.idx(10, 10);
    const one = { ...noResources(), roundabouts: 1 };
    expect(toggleRoundabout(g, [g.idx(5, 10)], one).message).toBe('Göbek yalnızca kavşağa konur');
    toggleSignal(g, [c], UNLIMITED);
    expect(toggleRoundabout(g, [c], one).message).toBe('Önce trafik ışığını kaldırın');
    toggleSignal(g, [c], UNLIMITED);
    expect(toggleRoundabout(g, [c], one).spent.roundabouts).toBe(1);
    expect(toggleSignal(g, [c], UNLIMITED).message).toBe('Bu kavşakta göbek var');
    expect(eraseRoad(g, [c]).spent.roundabouts).toBe(-1);
    expect(g.roundabout[c]).toBe(0);
  });

  it('let cars enter at speed instead of stopping, without collisions', () => {
    const { sim, centre } = crossing(true, 12);
    const entries: number[] = [];
    const seen = new Set<number>();
    runFor(sim, 300, () => {
      assertNoOverlap(sim);
      for (const v of sim.vehicles) {
        if (v.junction?.node !== centre || seen.has(v.id)) continue;
        seen.add(v.id);
        entries.push(v.v);
      }
    });
    expect(sim.stats.completed).toBe(24);
    expect(Math.max(...entries)).toBeLessThanOrEqual(ROUNDABOUT.entrySpeed + 1);
    // Most cars roll in instead of stopping to give way.
    expect(entries.filter((v) => v > JUNCTION.yieldSpeed + 1).length).toBeGreaterThan(entries.length / 2);
  });

  it('clear a busy crossing faster than giving way', () => {
    const time = (withRoundabout: boolean): number => {
      const { sim } = crossing(withRoundabout, 20);
      let t = 0;
      runFor(sim, 600, () => {
        if (sim.stats.completed < 40) t = sim.time;
      });
      expect(sim.stats.completed).toBe(40);
      return t;
    };
    expect(time(true)).toBeLessThan(time(false));
  });
});
