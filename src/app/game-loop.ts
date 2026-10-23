import { FixedStepper } from '../core/fixed-step';

export interface LoopCallbacks {
  /** Whether simulation time may advance this frame. */
  running(): boolean;
  speed(): number;
  /** Executes one fixed simulation step. */
  step(): void;
  /** Draws a frame; `alpha` interpolates between the last two steps. */
  frame(alpha: number, frameSeconds: number, stepped: boolean): void;
  error(err: unknown): void;
}

/**
 * requestAnimationFrame driver around the fixed-step simulation. Rendering
 * runs at display rate; the simulation runs at a fixed tick rate. When the
 * tab is hidden the browser pauses rAF, and the stepper clamps the gap on
 * return so the game never fast-forwards.
 */
export class GameLoop {
  private readonly stepper = new FixedStepper();
  private handle = 0;
  private last = 0;
  private active = false;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.handle);
  }

  /** Discards accumulated time, e.g. after loading or unpausing. */
  reset(): void {
    this.stepper.reset();
    this.last = performance.now();
  }

  private tick = (now: number): void => {
    if (!this.active) return;
    const dt = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    try {
      const plan = this.stepper.advance(dt, this.cb.speed(), !this.cb.running());
      for (let i = 0; i < plan.steps; i++) this.cb.step();
      this.cb.frame(plan.alpha, Math.min(dt, 0.25), plan.steps > 0);
    } catch (err) {
      this.active = false;
      this.cb.error(err);
      return;
    }
    this.handle = requestAnimationFrame(this.tick);
  };
}
