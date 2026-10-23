import type { GameMode } from '../core/constants';
import type { SimStats } from '../core/simulation';

export interface GameSummary {
  districtId: string;
  districtName: string;
  mode: GameMode;
  seed: number;
  score: number;
  /** Simulated seconds. */
  duration: number;
  week: number;
  completed: number;
  failed: number;
  spawned: number;
  averageTravelTime: number;
  averageWaitTime: number;
  onTimeRate: number;
  /** Free-flow time / actual travel time over completed trips (0..1). */
  efficiency: number;
  longestQueue: number;
  reason: string;
  finishedAt: string;
}

export function summarize(
  stats: SimStats,
  meta: {
    districtId: string;
    districtName: string;
    mode: GameMode;
    seed: number;
    score: number;
    duration: number;
    week: number;
    reason: string;
  },
  finishedAt: Date,
): GameSummary {
  const completed = stats.completed;
  return {
    ...meta,
    completed,
    failed: stats.failed,
    spawned: stats.spawned,
    averageTravelTime: completed > 0 ? stats.totalTravelTime / completed : 0,
    averageWaitTime: completed > 0 ? stats.totalWaitTime / completed : 0,
    onTimeRate: completed > 0 ? stats.onTime / completed : 0,
    efficiency: stats.totalTravelTime > 0 ? Math.min(1, stats.totalFreeFlowTime / stats.totalTravelTime) : 0,
    longestQueue: stats.longestQueueEver,
    finishedAt: finishedAt.toISOString(),
  };
}
