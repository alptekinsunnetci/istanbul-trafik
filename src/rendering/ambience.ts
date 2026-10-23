import { Container, Graphics } from 'pixi.js';
import { AMBIENCE } from '../core/constants';
import type { GameSession } from '../gameplay/game-session';
import { metrobusRoutes } from './map-renderer';
import type { Theme } from './theme';

const BUS_LENGTH = 18;
const BUS_WIDTH = 3.4;

interface Bus {
  /** Polyline in world metres. */
  points: [number, number][];
  /** Cumulative length at each point. */
  at: number[];
  s: number;
}

/**
 * Decorative city life drawn on the map: the metrobüs on its own lane along
 * the D-100 / O-1 (it never interacts with traffic) and the gull the session
 * lets fly over the water.
 */
export class Ambience {
  readonly container = new Container();
  private readonly busShape = new Graphics();
  private readonly gullShape = new Graphics();
  private bus: Bus | null = null;
  private nextBusAt = 8;
  private lastSimTime = -1;
  private flap = 0;
  private routes: [number, number][][] = [];
  private session: GameSession | null = null;

  constructor() {
    this.busShape.visible = false;
    this.gullShape.visible = false;
    this.container.addChild(this.busShape, this.gullShape);
  }

  setSession(session: GameSession | null, theme: Theme): void {
    this.session = session;
    this.bus = null;
    this.lastSimTime = -1;
    this.nextBusAt = 8;
    this.busShape.visible = false;
    this.gullShape.visible = false;
    this.routes = session ? metrobusRoutes(session.sim.grid, session.district) : [];
    this.drawShapes(theme);
  }

  update(frameSeconds: number, reduceMotion: boolean): void {
    const s = this.session;
    if (!s) return;
    const time = s.sim.time;
    // The metrobüs moves with simulated time: it stops while the game is paused.
    const dt = this.lastSimTime < 0 ? 0 : Math.max(0, time - this.lastSimTime);
    this.lastSimTime = time;
    this.updateBus(time, dt);
    this.flap += reduceMotion ? 0 : frameSeconds;
    const g = s.gull;
    this.gullShape.visible = g !== null;
    if (g) {
      this.gullShape.position.set(g.x, g.y);
      this.gullShape.rotation = Math.atan2(g.vy, g.vx) + Math.PI / 2;
      // Wing beat.
      this.gullShape.scale.set(1, 0.75 + 0.25 * Math.sin(this.flap * 9));
    }
  }

  /** World position of the gull, if one is flying. */
  gullAt(): { x: number; y: number } | null {
    const g = this.session?.gull;
    return g ? { x: g.x, y: g.y } : null;
  }

  private updateBus(time: number, dt: number): void {
    const bus = this.bus;
    if (bus) {
      bus.s += AMBIENCE.metrobusSpeed * dt;
      const total = bus.at[bus.at.length - 1] as number;
      if (bus.s - BUS_LENGTH > total) {
        this.bus = null;
        this.busShape.visible = false;
        this.nextBusAt = time + AMBIENCE.metrobusInterval;
        return;
      }
      const p = pointAt(bus, bus.s);
      this.busShape.position.set(p.x, p.y);
      this.busShape.rotation = p.angle;
      this.busShape.visible = true;
      return;
    }
    if (time < this.nextBusAt || this.routes.length === 0) return;
    const pick = this.routes[Math.floor(time / AMBIENCE.metrobusInterval) % this.routes.length] as [
      number,
      number,
    ][];
    const points = Math.floor(time) % 2 === 0 ? pick : [...pick].reverse();
    const at = [0];
    for (let k = 1; k < points.length; k++) {
      const [ax, ay] = points[k - 1] as [number, number];
      const [bx, by] = points[k] as [number, number];
      at.push((at[k - 1] as number) + Math.hypot(bx - ax, by - ay));
    }
    this.bus = { points, at, s: 0 };
  }

  private drawShapes(theme: Theme): void {
    const b = this.busShape;
    b.clear();
    const half = BUS_LENGTH / 2;
    const w = BUS_WIDTH / 2;
    // Two red, articulated bodies with a white band and dark windows (pointing along +x).
    b.roundRect(-half, -w, BUS_LENGTH * 0.52, BUS_WIDTH, 1.2).fill(0xc8372f);
    b.roundRect(-half + BUS_LENGTH * 0.54, -w, BUS_LENGTH * 0.46, BUS_WIDTH, 1.2).fill(0xc8372f);
    b.rect(-half + 0.6, -0.35, BUS_LENGTH - 1.2, 0.7).fill(0xffffff);
    b.rect(half - 1.6, -w + 0.4, 1, BUS_WIDTH - 0.8).fill(theme.road);
    b.circle(0, 0, 0.9).fill(0x8c241e);
    const g = this.gullShape;
    g.clear();
    // Shadow on the water, then a white gull with grey wing tips (seen from above, flying up).
    g.ellipse(2.5, 3, 4, 1.2).fill({ color: theme.shadow, alpha: 0.18 });
    g.poly([-6, 1.5, -2.5, -0.8, 0, 0.6, 2.5, -0.8, 6, 1.5, 2.5, 1, 0, 2.4, -2.5, 1]).fill(0xffffff);
    g.poly([-6, 1.5, -4.6, 0.3, -4.2, 1.3]).fill(0x6b7480);
    g.poly([6, 1.5, 4.6, 0.3, 4.2, 1.3]).fill(0x6b7480);
    g.ellipse(0, 0.4, 0.9, 2.4).fill(0xffffff).stroke({ width: 0.4, color: 0x9aa3ad });
    g.circle(0, -1.9, 0.35).fill(0xf2b33d);
  }
}

function pointAt(bus: Bus, s: number): { x: number; y: number; angle: number } {
  const at = bus.at;
  let k = 1;
  while (k < at.length - 1 && (at[k] as number) < s) k++;
  const [ax, ay] = bus.points[k - 1] as [number, number];
  const [bx, by] = bus.points[k] as [number, number];
  const len = Math.max(1e-6, (at[k] as number) - (at[k - 1] as number));
  const t = Math.min(1, Math.max(0, (s - (at[k - 1] as number)) / len));
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax) };
}
