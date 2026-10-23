import { describe, expect, it } from 'vitest';
import { DT, IDM } from '../../src/core/constants';
import { idmAcceleration, integrate, stopLineGap } from '../../src/traffic/car-following';

describe('IDM car following', () => {
  it('slows down safely behind a stopped vehicle and never collides', () => {
    const leaderRear = 120;
    let x = 0;
    let v = 14;
    let minGap = Infinity;
    for (let t = 0; t < 60 / DT; t++) {
      const a = idmAcceleration(v, 14, leaderRear - x, v);
      expect(a).toBeGreaterThanOrEqual(-IDM.maxDecel);
      const step = integrate(v, a, DT);
      v = step.v;
      x += step.ds;
      expect(v).toBeGreaterThanOrEqual(0);
      minGap = Math.min(minGap, leaderRear - x);
    }
    expect(minGap).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.05);
    expect(leaderRear - x).toBeCloseTo(IDM.minGap, 0);
  });

  it('accelerates again when the leader drives off', () => {
    let gap = IDM.minGap;
    let v = 0;
    const leaderSpeed = 10;
    for (let t = 0; t < 30 / DT; t++) {
      const a = idmAcceleration(v, 14, gap, v - leaderSpeed);
      const s = integrate(v, a, DT);
      gap += leaderSpeed * DT - s.ds;
      v = s.v;
    }
    expect(v).toBeGreaterThan(9);
    expect(gap).toBeGreaterThan(IDM.minGap);
  });

  it('stops at a stop line without crossing it', () => {
    let x = 0;
    let v = 13.9;
    const line = 80;
    for (let t = 0; t < 40 / DT; t++) {
      const a = idmAcceleration(v, 13.9, stopLineGap(line - x), v);
      const s = integrate(v, a, DT);
      x += s.ds;
      v = s.v;
    }
    expect(x).toBeLessThanOrEqual(line);
    expect(line - x).toBeLessThan(1);
  });

  it('a platoon remains stable and collision-free when the leader brakes hard', () => {
    const n = 12;
    const len = 4.5;
    const xs = Array.from({ length: n }, (_, i) => -i * 25);
    const vs = Array.from({ length: n }, () => 13);
    for (let t = 0; t < 90 / DT; t++) {
      const time = t * DT;
      const acc = xs.map((x, i) => {
        if (i === 0) return time > 10 && time < 14 ? -6 : idmAcceleration(vs[0]!, 13, Infinity, 0);
        const gap = xs[i - 1]! - len - x;
        return idmAcceleration(vs[i]!, 13, gap, vs[i]! - vs[i - 1]!);
      });
      for (let i = 0; i < n; i++) {
        const s = integrate(vs[i]!, acc[i]!, DT);
        xs[i] = xs[i]! + s.ds;
        vs[i] = s.v;
      }
      for (let i = 1; i < n; i++) {
        expect(xs[i - 1]! - len - xs[i]!).toBeGreaterThan(0);
        expect(Number.isFinite(xs[i]!)).toBe(true);
      }
    }
  });

  it('integration never moves backwards', () => {
    const s = integrate(1, -9, DT * 4);
    expect(s.v).toBe(0);
    expect(s.ds).toBeGreaterThanOrEqual(0);
    expect(s.ds).toBeLessThanOrEqual(1 * DT * 4);
  });
});
