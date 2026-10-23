import { describe, expect, it } from 'vitest';
import { JUNCTION, SIGNAL } from '../../src/core/constants';
import type { Building } from '../../src/core/world-state';
import { GameSession } from '../../src/gameplay/game-session';
import { eraseRoad, toggleSignal, UNLIMITED, noResources } from '../../src/map/road-editor';
import { axisOf } from '../../src/traffic/junction-controller';
import { addBuilding, addTrip, assertNoOverlap, makeSim, road, runFor, testGrid } from '../helpers';

/** A plain crossing with straight traffic on both axes; optionally signalled. */
function crossing(withLight: boolean, trips: number) {
  const g = testGrid(30, 30);
  const b: Building[] = [];
  const west = addBuilding(g, b, 'konut', 2, 14, 1);
  const north = addBuilding(g, b, 'konut', 14, 2, 2);
  const east = addBuilding(g, b, 'ticari', 26, 14, 3);
  const south = addBuilding(g, b, 'ticari', 14, 26, 0);
  road(g, [3, 14], [25, 14]);
  road(g, [14, 3], [14, 25]);
  const centre = g.idx(14, 14);
  if (withLight) expect(toggleSignal(g, [centre], UNLIMITED).ok).toBe(true);
  const sim = makeSim(g, b);
  addTrip(sim, west, east, trips);
  addTrip(sim, north, south, trips);
  return { g, sim, centre };
}

describe('traffic lights', () => {
  it('go only on junctions, use a piece and give it back when removed or erased', () => {
    const g = testGrid(20, 20);
    road(g, [2, 10], [17, 10]);
    road(g, [10, 2], [10, 10]);
    const budget = { ...noResources(), lights: 1 };
    expect(toggleSignal(g, [g.idx(5, 10)], budget).message).toBe('Trafik ışığı yalnızca kavşağa konur');
    expect(toggleSignal(g, [g.idx(5, 5)], budget).ok).toBe(false);
    const put = toggleSignal(g, [g.idx(10, 10)], budget);
    expect(put.ok).toBe(true);
    expect(put.spent.lights).toBe(1);
    expect(toggleSignal(g, [g.idx(10, 10)], noResources()).spent.lights).toBe(-1);
    expect(g.signal[g.idx(10, 10)]).toBe(0);
    expect(toggleSignal(g, [g.idx(10, 10)], noResources()).message).toBe('Trafik ışığı kalmadı');
    toggleSignal(g, [g.idx(10, 10)], budget);
    const erased = eraseRoad(g, [g.idx(10, 10)]);
    expect(erased.spent.lights).toBe(-1);
    expect(g.signal[g.idx(10, 10)]).toBe(0);
  });

  it('let only the green direction enter, alternate, and serve both directions', () => {
    const { sim, centre } = crossing(true, 12);
    const axesServed = new Set<number>();
    let switches = 0;
    let last = sim.junctions.signal(centre)!.axis;
    const inside = new Set<number>();
    runFor(sim, 300, () => {
      assertNoOverlap(sim);
      const st = sim.junctions.signal(centre)!;
      if (st.axis !== last) {
        switches++;
        last = st.axis;
      }
      for (const v of sim.vehicles) {
        const pass = v.junction;
        if (!pass || pass.node !== centre || inside.has(v.id)) continue;
        inside.add(v.id);
        // A vehicle that just entered came from the direction that has green.
        expect(axisOf(pass.inDir)).toBe(st.axis);
        axesServed.add(axisOf(pass.inDir));
      }
    });
    expect(sim.stats.completed).toBe(24);
    expect(axesServed.size).toBe(2);
    expect(switches).toBeGreaterThanOrEqual(2);
    expect(sim.gridlocks).toHaveLength(0);
  });

  it('keep green while nobody waits on the other side', () => {
    const g = testGrid(30, 30);
    const b: Building[] = [];
    const west = addBuilding(g, b, 'konut', 2, 14, 1);
    const east = addBuilding(g, b, 'ticari', 26, 14, 3);
    road(g, [3, 14], [25, 14]);
    road(g, [14, 3], [14, 25]);
    const centre = g.idx(14, 14);
    toggleSignal(g, [centre], UNLIMITED);
    const sim = makeSim(g, b);
    addTrip(sim, west, east, 6);
    runFor(sim, SIGNAL.maxGreen * 6);
    // Only east–west traffic: the light turned to it once and stayed.
    expect(sim.junctions.signal(centre)!.axis).toBe(1);
    expect(sim.stats.completed).toBe(6);
  });

  it('are offered as a weekly reward and start in the toolbox', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 1 });
    expect(s.resources.lights).toBeGreaterThan(0);
    s.dispose();
  });

  it('a light clears a busy crossing faster than giving way', () => {
    const time = (withLight: boolean): number => {
      const { sim } = crossing(withLight, 20);
      let t = 0;
      runFor(sim, 600, () => {
        if (sim.stats.completed < 40) t = sim.time;
      });
      expect(sim.stats.completed).toBe(40);
      return t;
    };
    // Without a light every car has to slow down while the crossing road is busy.
    expect(time(true)).toBeLessThan(time(false));
  });

  it('on a highway the main road has priority; the side street gives way', () => {
    const g = testGrid(30, 30);
    const b: Building[] = [];
    const west = addBuilding(g, b, 'konut', 2, 14, 1);
    const east = addBuilding(g, b, 'ticari', 26, 14, 3);
    const side = addBuilding(g, b, 'konut', 14, 24, 0);
    road(g, [3, 14], [25, 14]);
    // Turn the main road into a highway.
    for (let x = 4; x <= 24; x++) {
      const c = g.idx(x, 14);
      g.highway[c] = 1;
      g.lanes[c] = 2;
    }
    road(g, [14, 23], [14, 14]);
    const sim = makeSim(g, b);
    addTrip(sim, west, east, 20);
    addTrip(sim, side, east, 6);
    const node = g.idx(14, 14);
    const mainline: number[] = [];
    const street: number[] = [];
    const seen = new Set<number>();
    runFor(sim, 240, () => {
      for (const v of sim.vehicles) {
        if (!v.junction || v.junction.node !== node || seen.has(v.id)) continue;
        seen.add(v.id);
        if (v.junction.inDir === 1) {
          mainline.push(v.v);
          continue;
        }
        // Was a highway car close to the junction when this street car went in?
        const busy = sim.vehicles.some((o) => {
          if (o === v || o.junction) return false;
          const e = sim.graph.edge(o.edge);
          return e !== undefined && e.to === node && e.lastDir === 1 && e.length - o.s <= JUNCTION.yieldWatch;
        });
        if (busy) street.push(v.v);
      }
    });
    expect(sim.stats.completed).toBe(26);
    // Highway cars keep their speed through the junction...
    expect(mainline.filter((x) => x > JUNCTION.yieldSpeed + 1).length).toBeGreaterThan(mainline.length / 2);
    // ...cars from the street that go in while highway traffic is near have given way first.
    expect(street.length).toBeGreaterThan(0);
    expect(Math.max(...street)).toBeLessThanOrEqual(JUNCTION.yieldSpeed + 0.5);
  });
});
