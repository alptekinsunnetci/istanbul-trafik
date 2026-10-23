import { DT, SIM } from './constants';

export interface StepPlan {
  steps: number;
  /** Interpolation factor between the previous and the current simulation state. */
  alpha: number;
}

/**
 * Converts variable frame times into a whole number of fixed simulation
 * steps. Long gaps (background tabs, debugger pauses) are clamped so the
 * simulation never jumps ahead, and the number of steps per frame is capped
 * so a slow device degrades into slow motion instead of a death spiral.
 */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    private readonly step: number = DT,
    private readonly maxSteps: number = SIM.maxStepsPerFrame,
    private readonly maxFrameGap: number = SIM.maxFrameGap,
  ) {}

  advance(frameSeconds: number, speed: number, paused: boolean): StepPlan {
    if (paused || !(frameSeconds > 0)) {
      return { steps: 0, alpha: this.accumulator / this.step };
    }
    this.accumulator += Math.min(frameSeconds, this.maxFrameGap) * speed;
    let steps = Math.floor(this.accumulator / this.step);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.step;
    }
    return { steps, alpha: this.accumulator / this.step };
  }

  reset(): void {
    this.accumulator = 0;
  }
}
