import { describe, expect, it } from 'vitest';
import { zonesFor, zonesOverlap } from '../../src/traffic/conflict-zones';
import { JunctionController, type JunctionRequest } from '../../src/traffic/junction-controller';

function req(partial: Partial<JunctionRequest> & Pick<JunctionRequest, 'id' | 'zones'>): JunctionRequest {
  return {
    node: 7,
    key: `m${partial.id}`,
    exitLaneKey: partial.id * 10,
    need: 6.5,
    available: 50,
    wait: 0,
    instant: false,
    ...partial,
  };
}

describe('conflict zones', () => {
  it('maps turns to quadrant counts', () => {
    expect(zonesFor(0, 'right')).toEqual([1]);
    expect(zonesFor(0, 'straight')).toEqual([1, 0]);
    expect(zonesFor(0, 'left')).toEqual([1, 0, 3]);
    expect(zonesFor(0, 'uturn')).toHaveLength(4);
  });

  it('opposite right turns are compatible, crossing movements conflict', () => {
    expect(zonesOverlap(zonesFor(0, 'right'), zonesFor(2, 'right'))).toBe(false);
    expect(zonesOverlap(zonesFor(0, 'straight'), zonesFor(2, 'straight'))).toBe(false);
    expect(zonesOverlap(zonesFor(0, 'straight'), zonesFor(1, 'straight'))).toBe(true);
    expect(zonesOverlap(zonesFor(0, 'left'), zonesFor(2, 'straight'))).toBe(true);
  });
});

describe('junction controller', () => {
  it('never grants conflicting movements in the same step', () => {
    const jc = new JunctionController();
    const granted = jc.resolve([
      req({ id: 1, zones: zonesFor(0, 'straight'), wait: 1 }),
      req({ id: 2, zones: zonesFor(1, 'straight'), wait: 2 }),
    ]);
    expect(granted.map((g) => g.id)).toEqual([2]);
    expect(jc.holder(7, zonesFor(1, 'straight')[0]!)).toBe('m2');
  });

  it('grants compatible movements together', () => {
    const jc = new JunctionController();
    const granted = jc.resolve([
      req({ id: 1, zones: zonesFor(0, 'straight') }),
      req({ id: 2, zones: zonesFor(2, 'straight') }),
    ]);
    expect(granted.map((g) => g.id).sort()).toEqual([1, 2]);
  });

  it('keeps zones held until release', () => {
    const jc = new JunctionController();
    jc.resolve([req({ id: 1, zones: [0, 1] })]);
    expect(jc.resolve([req({ id: 2, zones: [1] })])).toHaveLength(0);
    jc.release(7, [0, 1], 'm1', 10, 6.5);
    expect(jc.resolve([req({ id: 2, zones: [1] })])).toHaveLength(1);
  });

  it('lets a platoon on the same movement share zones until the last one leaves', () => {
    const jc = new JunctionController();
    jc.resolve([req({ id: 1, zones: [1, 0], key: 'A', exitLaneKey: 5 })]);
    expect(jc.resolve([req({ id: 2, zones: [1, 0], key: 'A', exitLaneKey: 5 })])).toHaveLength(1);
    // A conflicting movement must wait for the whole platoon.
    expect(jc.resolve([req({ id: 3, zones: [0], key: 'B' })])).toHaveLength(0);
    jc.release(7, [1, 0], 'A', 5, 6.5);
    expect(jc.holder(7, 0)).toBe('A');
    jc.release(7, [1, 0], 'A', 5, 6.5);
    expect(jc.holder(7, 0)).toBeNull();
    expect(jc.reservedOn(5)).toBe(0);
  });

  it('a starving conflicting request ends a platoon', () => {
    const jc = new JunctionController();
    jc.resolve([req({ id: 1, zones: [1, 0], key: 'A' })]);
    const granted = jc.resolve([
      req({ id: 3, zones: [0], key: 'B', wait: 30 }),
      req({ id: 2, zones: [1, 0], key: 'A', wait: 0 }),
    ]);
    expect(granted).toHaveLength(0);
  });

  it('refuses entry when the exit lane lacks space, including reservations', () => {
    const jc = new JunctionController();
    expect(jc.resolve([req({ id: 1, zones: [0], available: 5 })])).toHaveLength(0);
    // Two vehicles from compatible movements to the same exit with room for only one.
    const granted = jc.resolve([
      req({ id: 2, zones: [0], exitLaneKey: 99, available: 10 }),
      req({ id: 3, zones: [2], exitLaneKey: 99, available: 10 }),
    ]);
    expect(granted).toHaveLength(1);
    expect(jc.reservedOn(99)).toBeCloseTo(6.5);
  });

  it('serves the longest waiting request first and protects starving requests', () => {
    const jc = new JunctionController();
    // A starving left turn (3 zones) is blocked by a holder; lower-priority requests may not take its zones.
    jc.resolve([req({ id: 9, zones: [3] })]);
    const granted = jc.resolve([
      req({ id: 1, zones: [1, 0, 3], wait: 20 }),
      req({ id: 2, zones: [1], wait: 1 }),
      req({ id: 4, zones: [2], wait: 1 }),
    ]);
    expect(granted.map((g) => g.id)).toEqual([4]);
  });

  it('instant (spawn) grants do not keep zones but consume exit space', () => {
    const jc = new JunctionController();
    const granted = jc.resolve([
      req({ id: -1, zones: [0, 1, 2, 3], instant: true, exitLaneKey: 5, available: 8, wait: 3 }),
      req({ id: 2, zones: [2], exitLaneKey: 5, available: 8, wait: 1 }),
    ]);
    expect(granted.map((g) => g.id)).toEqual([-1]);
    expect(jc.isBusy(7)).toBe(false);
  });
});
