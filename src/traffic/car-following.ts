import { IDM } from '../core/constants';

export interface IdmParams {
  maxAccel: number;
  comfortDecel: number;
  maxDecel: number;
  minGap: number;
  timeHeadway: number;
  delta: number;
}

/**
 * Intelligent Driver Model acceleration.
 * @param v own speed
 * @param v0 desired speed
 * @param gap bumper-to-bumper distance to the obstacle (Infinity = free road)
 * @param dv approach rate (own speed − leader speed)
 */
export function idmAcceleration(v: number, v0: number, gap: number, dv: number, p: IdmParams = IDM): number {
  if (v0 <= 0.01) return -p.maxDecel;
  const free = 1 - Math.pow(Math.max(v, 0) / v0, p.delta);
  if (!Number.isFinite(gap)) return clamp(p.maxAccel * free, -p.maxDecel, p.maxAccel);
  const sStar =
    p.minGap + Math.max(0, v * p.timeHeadway + (v * dv) / (2 * Math.sqrt(p.maxAccel * p.comfortDecel)));
  const g = Math.max(gap, 0.05);
  const interaction = (sStar / g) * (sStar / g);
  return clamp(p.maxAccel * (free - interaction), -p.maxDecel, p.maxAccel);
}

/**
 * Gap value that makes IDM come to rest `margin` metres before a stop line
 * located `distance` metres ahead (IDM rests at a gap of `minGap`).
 */
export function stopLineGap(distance: number, margin = 0.3, p: IdmParams = IDM): number {
  return distance + p.minGap - margin;
}

/**
 * Advances speed and position for one step with ballistic integration that
 * never produces negative speeds or backward motion.
 */
export function integrate(v: number, a: number, dt: number): { v: number; ds: number } {
  const nv = v + a * dt;
  if (nv >= 0) return { v: nv, ds: Math.max(0, (v + nv) * 0.5 * dt) };
  // The vehicle stops within this step.
  const ds = a < 0 ? (v * v) / (-2 * a) : 0;
  return { v: 0, ds: Math.max(0, ds) };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
