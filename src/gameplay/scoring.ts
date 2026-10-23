export interface ScoreState {
  points: number;
}

/** The score is simply the number of completed trips. */
export class ScoreKeeper {
  points = 0;

  onCompleted(): void {
    this.points++;
  }

  get score(): number {
    return this.points;
  }

  toState(): ScoreState {
    return { points: this.points };
  }

  load(state: ScoreState): void {
    this.points = Math.max(0, Math.floor(state.points));
  }
}
