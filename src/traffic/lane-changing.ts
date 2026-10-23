import { IDM, LANE_CHANGE } from '../core/constants';
import type { GraphEdge } from '../map/road-graph';
import { idmAcceleration } from './car-following';
import type { JunctionController } from './junction-controller';
import { type LaneManager, laneKey } from './lane-manager';
import type { Vehicle } from './vehicle-model';

export interface LaneChangeEnv {
  lanes: LaneManager;
  junctions: JunctionController;
}

function accelBehind(v: Vehicle, leader: Vehicle | null, v0: number): number {
  if (!leader) return idmAcceleration(v.v, v0, Infinity, 0);
  return idmAcceleration(v.v, v0, leader.s - leader.length - v.s, v.v - leader.v);
}

/**
 * MOBIL-style safety criterion: the gaps to the new leader and new follower
 * must be positive and neither the vehicle itself nor the new follower may
 * be forced to brake harder than `safeDecel`.
 */
export function laneChangeSafe(
  v: Vehicle,
  edge: GraphEdge,
  target: number,
  v0: number,
  env: LaneChangeEnv,
  safeDecel: number = LANE_CHANGE.safeDecel,
): boolean {
  if (target < 0 || target >= edge.lanes) return false;
  const key = laneKey(edge.index, target);
  const leader = env.lanes.leader(key, v.s, v);
  const follower = env.lanes.follower(key, v.s, v);
  const minGap = IDM.minGap * 0.5;
  if (leader) {
    const gap = leader.s - leader.length - v.s;
    if (gap < minGap) return false;
    if (accelBehind(v, leader, v0) < -safeDecel) return false;
  }
  if (follower) {
    const gap = v.s - v.length - follower.s;
    if (gap < minGap) return false;
    const fv0 = edge.speedLimit * follower.speedFactor;
    const a = idmAcceleration(follower.v, fv0, gap, follower.v - v.v);
    if (a < -safeDecel) return false;
  }
  // Keep clear of the space reserved for vehicles about to enter the lane.
  if (v.s - v.length < env.junctions.reservedOn(key) + 0.5) return false;
  return true;
}

/**
 * Picks a target lane or returns null.
 * @param required lanes allowed for the next turn (null = any lane)
 */
export function chooseLaneChange(
  v: Vehicle,
  edge: GraphEdge,
  required: readonly number[] | null,
  v0: number,
  env: LaneChangeEnv,
): number | null {
  const distToEnd = edge.length - v.s;
  const inPreparation = distToEnd <= LANE_CHANGE.mandatoryLookahead;

  if (required && inPreparation && !required.includes(v.lane)) {
    const nearest = required.reduce((best, l) => (Math.abs(l - v.lane) < Math.abs(best - v.lane) ? l : best));
    const target = v.lane + Math.sign(nearest - v.lane);
    // Urgency relaxes the comfort limit as the stop line gets closer.
    const urgency = 1 + (1 - distToEnd / LANE_CHANGE.mandatoryLookahead);
    return laneChangeSafe(v, edge, target, v0, env, LANE_CHANGE.safeDecel * urgency) ? target : null;
  }

  const ownKey = laneKey(edge.index, v.lane);
  const currentLeader = env.lanes.leader(ownKey, v.s, v);
  if (!currentLeader) return null;
  const aCur = accelBehind(v, currentLeader, v0);
  if (aCur > IDM.maxAccel * 0.5) return null;

  let best: number | null = null;
  let bestGain: number = LANE_CHANGE.threshold;
  for (const target of [v.lane - 1, v.lane + 1]) {
    if (target < 0 || target >= edge.lanes) continue;
    if (required && inPreparation && !required.includes(target)) continue;
    if (!laneChangeSafe(v, edge, target, v0, env)) continue;
    const key = laneKey(edge.index, target);
    const aNew = accelBehind(v, env.lanes.leader(key, v.s, v), v0);
    const follower = env.lanes.follower(key, v.s, v);
    let followerCost = 0;
    if (follower) {
      const fv0 = edge.speedLimit * follower.speedFactor;
      const before = accelBehind(follower, env.lanes.leader(key, follower.s, follower), fv0);
      const after = idmAcceleration(follower.v, fv0, v.s - v.length - follower.s, follower.v - v.v);
      followerCost = Math.max(0, before - after);
    }
    const gain = aNew - aCur - LANE_CHANGE.politeness * followerCost;
    if (gain > bestGain) {
      bestGain = gain;
      best = target;
    }
  }
  return best;
}
