import { describe, expect, it } from 'vitest';
import { UNLIMITED, setBoulevard } from '../../src/map/road-editor';
import { buildGraph } from '../../src/map/topology';
import { JunctionController } from '../../src/traffic/junction-controller';
import { chooseLaneChange, laneChangeSafe } from '../../src/traffic/lane-changing';
import { LaneManager, laneKey } from '../../src/traffic/lane-manager';
import { QueueManager } from '../../src/traffic/queue-manager';
import { type Vehicle, createVehicle } from '../../src/traffic/vehicle-model';
import { road, segment, testGrid } from '../helpers';

function setup(boulevard: boolean) {
  const g = testGrid(30, 12);
  road(g, [1, 5], [28, 5]);
  if (boulevard) setBoulevard(g, segment(g, 1, 5, 28, 5), UNLIMITED);
  const graph = buildGraph(g);
  const edge = graph.edge(`${g.idx(1, 5)}>1`)!;
  return { g, graph, edge };
}

let nextId = 1;
function car(edgeId: string, lane: number, s: number, v: number): Vehicle {
  const veh = createVehicle(nextId++, 'car', { id: 0, origin: 0, destination: 1 }, [edgeId], 0, 10, 0.5);
  veh.lane = lane;
  veh.s = s;
  veh.v = v;
  return veh;
}

describe('queues', () => {
  it('counts the contiguous run of slow vehicles from the stop line', () => {
    const { graph, edge } = setup(false);
    const vehicles = [
      car(edge.id, 0, edge.length - 0.3, 0),
      car(edge.id, 0, edge.length - 7, 0.2),
      car(edge.id, 0, edge.length - 14, 0),
      car(edge.id, 0, edge.length - 60, 12),
      car(edge.id, 0, edge.length - 120, 0),
    ];
    const lanes = new LaneManager();
    lanes.rebuild(graph, vehicles);
    const q = new QueueManager();
    q.resize(graph);
    q.update(graph, lanes);
    expect(q.snapshot.longestQueue).toBe(3);
    expect(q.queued[edge.index]).toBe(4);
    expect(q.count[edge.index]).toBe(5);
    expect(q.snapshot.utilization).toBeGreaterThan(0);
    expect(q.occupancy(edge)).toBeGreaterThan(0);
  });

  it('orders lanes front-first and finds leaders and followers', () => {
    const { graph, edge } = setup(false);
    const a = car(edge.id, 0, 100, 5);
    const b = car(edge.id, 0, 50, 5);
    const c = car(edge.id, 0, 10, 5);
    const lanes = new LaneManager();
    lanes.rebuild(graph, [c, a, b]);
    const key = laneKey(edge.index, 0);
    expect(lanes.first(key)).toBe(a);
    expect(lanes.last(key)).toBe(c);
    expect(lanes.leader(key, b.s, b)).toBe(a);
    expect(lanes.follower(key, b.s, b)).toBe(c);
    expect(lanes.leader(key, a.s, a)).toBeNull();
  });
});

describe('lane changing', () => {
  it('rejects a change when the target lane gap is too small', () => {
    const { graph, edge } = setup(true);
    const me = car(edge.id, 0, 100, 12);
    const beside = car(edge.id, 1, 101, 12);
    const lanes = new LaneManager();
    lanes.rebuild(graph, [me, beside]);
    const env = { lanes, junctions: new JunctionController() };
    expect(laneChangeSafe(me, edge, 1, edge.speedLimit, env)).toBe(false);
  });

  it('rejects a change that would force the new follower to brake hard', () => {
    const { graph, edge } = setup(true);
    const me = car(edge.id, 0, 100, 3);
    const fast = car(edge.id, 1, 92, 19);
    const lanes = new LaneManager();
    lanes.rebuild(graph, [me, fast]);
    const env = { lanes, junctions: new JunctionController() };
    expect(laneChangeSafe(me, edge, 1, edge.speedLimit, env)).toBe(false);
  });

  it('overtakes a slow leader when the other lane is free', () => {
    const { graph, edge } = setup(true);
    const me = car(edge.id, 0, 100, 15);
    const slow = car(edge.id, 0, 112, 2);
    const lanes = new LaneManager();
    lanes.rebuild(graph, [me, slow]);
    const env = { lanes, junctions: new JunctionController() };
    expect(laneChangeSafe(me, edge, 1, edge.speedLimit, env)).toBe(true);
    expect(chooseLaneChange(me, edge, null, edge.speedLimit, env)).toBe(1);
  });

  it('moves to the lane required for an upcoming turn', () => {
    const { graph, edge } = setup(true);
    const me = car(edge.id, 1, edge.length - 60, 10);
    const lanes = new LaneManager();
    lanes.rebuild(graph, [me]);
    const env = { lanes, junctions: new JunctionController() };
    expect(chooseLaneChange(me, edge, [0], edge.speedLimit, env)).toBe(0);
  });

  it('respects space reserved for vehicles entering the lane', () => {
    const { graph, edge } = setup(true);
    const me = car(edge.id, 0, 14, 5);
    const lanes = new LaneManager();
    lanes.rebuild(graph, [me]);
    const junctions = new JunctionController();
    junctions.acquire(edge.from, [0], 'm99', laneKey(edge.index, 1), 12);
    expect(laneChangeSafe(me, edge, 1, edge.speedLimit, { lanes, junctions })).toBe(false);
  });
});
