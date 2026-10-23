import { Application, Container, Graphics, Text } from 'pixi.js';
import { GEOM } from '../core/constants';
import type { GameSession } from '../gameplay/game-session';
import type { PreviewCell } from '../map/road-editor';
import { drawBuildingStatus, drawBuildings } from './building-renderer';
import { Ambience } from './ambience';
import { Camera } from './camera';
import { drawGridlocks, drawHover, drawPreview, drawSelection, drawSignals, drawTraffic } from './effects';
import { drawTerrain, placeHighwaySigns, placeLabels } from './map-renderer';
import { drawRoads } from './road-renderer';
import { DEFAULT_THEME, HIGH_CONTRAST_THEME, type Theme, districtTheme, groupColor, seasonOf } from './theme';
import { PathCache, VehicleRenderer } from './vehicle-renderer';

export interface RenderOptions {
  highContrast: boolean;
  showGrid: boolean;
  reduceMotion: boolean;
}

export class UnsupportedRendererError extends Error {
  constructor(cause: unknown) {
    super('WebGL desteklenmiyor', { cause });
    this.name = 'UnsupportedRendererError';
  }
}

/** PixiJS presentation of a game session. Reads simulation state, never changes it. */
export class Renderer {
  readonly camera = new Camera();
  private readonly world = new Container();
  private readonly terrain = new Graphics();
  private readonly labels = new Container();
  private readonly roads = new Graphics();
  private readonly signs = new Container();
  private readonly traffic = new Graphics();
  private readonly buildings = new Graphics();
  private readonly status = new Graphics();
  private readonly preview = new Graphics();
  private readonly hover = new Graphics();
  private readonly selection = new Graphics();
  private readonly gridlocks = new Graphics();
  private readonly lights = new Graphics();
  private readonly ambience = new Ambience();
  private readonly outside = new Graphics();
  private readonly hint = new Graphics();
  private readonly popups = new Container();
  private popupPool: Text[] = [];
  private activePopups: { text: Text; age: number }[] = [];
  private hintTarget: { from: number; to: number } | null = null;
  private camTarget: { scale: number; x: number; y: number } | null = null;
  private readonly vehicles: VehicleRenderer;
  private session: GameSession | null = null;
  private paths: PathCache | null = null;
  private theme: Theme = DEFAULT_THEME;
  /** Season the map is currently drawn in (changes every week). */
  private season = -1;
  private options: RenderOptions = { highContrast: false, showGrid: true, reduceMotion: false };
  private overlayTimer = 0;
  private time = 0;
  trafficOverlay = false;
  /** While true (the player is drawing) the camera never moves on its own. */
  holdCamera = false;

  /** True while the camera glides towards a new frame. */
  get cameraMoving(): boolean {
    return this.camTarget !== null;
  }
  selectedVehicle: number | null = null;
  selectedBuilding: number | null = null;

  private constructor(
    private readonly app: Application,
    private readonly host: HTMLElement,
  ) {
    this.vehicles = new VehicleRenderer();
    this.world.addChild(
      this.terrain,
      this.labels,
      this.roads,
      this.signs,
      this.traffic,
      this.buildings,
      this.status,
      this.outside,
      this.vehicles.container,
      this.ambience.container,
      this.lights,
      this.selection,
      this.gridlocks,
      this.hint,
      this.popups,
      this.preview,
      this.hover,
    );
    app.stage.addChild(this.world);
  }

  static async create(host: HTMLElement): Promise<Renderer> {
    const app = new Application();
    try {
      await app.init({
        resizeTo: host,
        background: DEFAULT_THEME.background,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        preference: 'webgl',
        autoStart: false,
      });
    } catch (err) {
      throw new UnsupportedRendererError(err);
    }
    app.ticker.stop();
    app.canvas.setAttribute('aria-label', 'Şehir haritası');
    app.canvas.setAttribute('role', 'img');
    app.canvas.tabIndex = 0;
    host.appendChild(app.canvas);
    const r = new Renderer(app, host);
    r.resize();
    return r;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  setOptions(options: RenderOptions): void {
    const themeChanged = options.highContrast !== this.options.highContrast;
    const gridChanged = options.showGrid !== this.options.showGrid;
    this.options = options;
    this.applyTheme();
    if (this.session && (themeChanged || gridChanged)) this.redrawStatic();
  }

  /** The base theme, tinted with the current district's ground and water colours and the season. */
  private applyTheme(): void {
    const base = this.options.highContrast ? HIGH_CONTRAST_THEME : DEFAULT_THEME;
    this.season = seasonOf(this.session?.week ?? 1);
    this.theme = districtTheme(base, this.session?.district.palette, this.season);
    this.app.renderer.background.color = this.theme.background;
  }

  setSession(session: GameSession | null): void {
    this.session = session;
    this.applyTheme();
    this.ambience.setSession(session, this.theme);
    this.vehicles.clear();
    this.selectedVehicle = null;
    this.selectedBuilding = null;
    this.preview.clear();
    this.hover.clear();
    if (!session) {
      for (const g of [
        this.terrain,
        this.roads,
        this.traffic,
        this.buildings,
        this.status,
        this.selection,
        this.gridlocks,
        this.lights,
      ])
        g.clear();
      this.clearLabels();
      this.paths = null;
      return;
    }
    const grid = session.sim.grid;
    this.paths = new PathCache(grid);
    this.camera.setWorld(grid.width * GEOM.cellSize, grid.height * GEOM.cellSize);
    this.resize();
    // Establish the zoom limits for the whole map, then frame the playable area.
    this.camera.fit(...this.insets());
    this.hintTarget = null;
    this.hint.clear();
    this.fitBounds(false);
    this.redrawStatic();
    this.captureVehicles();
  }

  private insets(): [number, number] {
    const mobile = this.host.clientWidth < 760;
    // Room for the HUD at the top and the labelled badges plus the hint at the bottom.
    return mobile ? [100, 170] : [76, 150];
  }

  /** Frames the playable area; `animate` glides there instead of jumping. */
  fitBounds(animate = true): void {
    const s = this.session;
    if (!s) return;
    const b = s.bounds;
    const C = GEOM.cellSize;
    const t = this.camera.computeFit(
      b.x0 * C,
      b.y0 * C,
      (b.x1 - b.x0 + 1) * C,
      (b.y1 - b.y0 + 1) * C,
      ...this.insets(),
    );
    if (animate && !this.options.reduceMotion) this.camTarget = t;
    else {
      this.camTarget = null;
      this.camera.set(t.scale, t.x, t.y);
    }
  }

  /** Same as fitBounds; kept for the "fit" shortcut. */
  fitCamera(): void {
    this.fitBounds(true);
  }

  /** Stops a running camera animation (the player took control). */
  cancelCameraAnimation(): void {
    this.camTarget = null;
  }

  /** The playable area changed: shade the outside again and glide to the new frame. */
  boundsChanged(): void {
    this.drawOutside();
    this.drawLabels();
    this.drawSigns();
    this.fitBounds(true);
  }

  private clearLabels(): void {
    for (const t of this.labels.removeChildren()) t.destroy();
    for (const t of this.signs.removeChildren()) t.destroy({ children: true });
  }

  /** Name signs on the highways (green: otoyol, blue: devlet yolu, dark: street). */
  private drawSigns(): void {
    for (const t of this.signs.removeChildren()) t.destroy({ children: true });
    const s = this.session;
    if (!s) return;
    for (const p of placeHighwaySigns(s.sim.grid, s.district, s.bounds)) {
      const color = p.text.startsWith('O-')
        ? this.theme.signOtoyol
        : p.text.startsWith('D-')
          ? this.theme.signDevlet
          : this.theme.signStreet;
      const text = new Text({
        text: p.text,
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 6, fontWeight: '800', fill: 0xffffff },
        resolution: 4,
      });
      text.anchor.set(0.5);
      const w = text.width + 6;
      const h = 9;
      const badge = new Graphics()
        .roundRect(-w / 2, -h / 2, w, h, 2.5)
        .fill(color)
        .stroke({ width: 1, color: 0xffffff });
      const sign = new Container();
      sign.addChild(badge, text);
      sign.position.set(p.x, p.y);
      this.signs.addChild(sign);
    }
  }

  /** Istanbul place names on the water and in parks of the playable area. */
  private drawLabels(): void {
    this.clearLabels();
    const s = this.session;
    if (!s) return;
    for (const p of placeLabels(s.sim.grid, s.district.labels, s.bounds)) {
      const water = p.kind === 'water';
      const big = water && !p.river;
      const text = new Text({
        text: p.text,
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: big ? 9 : p.river ? 5 : 6,
          fontWeight: '700',
          letterSpacing: big ? 3.5 : 1.2,
          fill: water ? this.theme.waterLabel : this.theme.parkLabel,
        },
        resolution: 4,
      });
      text.anchor.set(0.5);
      text.position.set(p.x, p.y);
      text.alpha = water ? 0.8 : 0.85;
      text.rotation = p.angle;
      this.labels.addChild(text);
    }
  }

  private drawOutside(): void {
    const s = this.session;
    const g = this.outside;
    g.clear();
    if (!s) return;
    const C = GEOM.cellSize;
    const b = s.bounds;
    const grid = s.sim.grid;
    const pad = C * 60;
    const x0 = b.x0 * C;
    const y0 = b.y0 * C;
    const x1 = (b.x1 + 1) * C;
    const y1 = (b.y1 + 1) * C;
    const W = grid.width * C;
    const H = grid.height * C;
    const fill = { color: this.theme.land, alpha: 0.78 };
    g.rect(-pad, -pad, W + 2 * pad, y0 + pad).fill(fill);
    g.rect(-pad, y1, W + 2 * pad, H - y1 + pad).fill(fill);
    g.rect(-pad, y0, x0 + pad, y1 - y0).fill(fill);
    g.rect(x1, y0, W - x1 + pad, y1 - y0).fill(fill);
    g.roundRect(x0, y0, x1 - x0, y1 - y0, 10).stroke({ width: 1.5, color: this.theme.road, alpha: 0.18 });
  }

  /** Tutorial hint: a dashed guide between two building doors (null hides it). */
  setHint(from: number | null, to: number | null): void {
    this.hintTarget = from !== null && to !== null ? { from, to } : null;
    if (!this.hintTarget) this.hint.clear();
  }

  private drawHint(pulse: number): void {
    const s = this.session;
    const h = this.hintTarget;
    const g = this.hint;
    g.clear();
    if (!s || !h) return;
    const grid = s.sim.grid;
    const C = GEOM.cellSize;
    const ax = (grid.cx(h.from) + 0.5) * C;
    const ay = (grid.cy(h.from) + 0.5) * C;
    const bx = (grid.cx(h.to) + 0.5) * C;
    const by = (grid.cy(h.to) + 0.5) * C;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.floor(len / 9));
    const phase = (this.time * 0.8) % 1;
    for (let k = 0; k < steps; k++) {
      const t0 = (k + phase) / steps;
      const t1 = Math.min(1, t0 + 0.45 / steps);
      g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1);
    }
    g.stroke({ width: 3, color: this.theme.route, alpha: 0.85, cap: 'round' });
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ] as const) {
      g.circle(x, y, 7 + pulse * 3).stroke({ width: 2.5, color: this.theme.route, alpha: 0.9 });
    }
  }

  /** Floating "+1" above a building after a delivery. */
  popScore(buildingId: number): void {
    const b = this.session?.sim.buildingById(buildingId);
    if (!b) return;
    const C = GEOM.cellSize;
    this.popText((b.x + b.w / 2) * C, b.y * C - 4, '+1');
  }

  /** A short floating text at a world position (e.g. "+1", "+2 yol"). */
  popText(x: number, y: number, label: string): void {
    if (this.options.reduceMotion) return;
    const text =
      this.popupPool.pop() ??
      new Text({
        text: '+1',
        style: {
          fontFamily: 'system-ui, sans-serif',
          fontSize: 11,
          fontWeight: '800',
          fill: this.theme.road,
          stroke: { color: 0xffffff, width: 3 },
        },
        resolution: 4,
      });
    text.anchor.set(0.5);
    text.text = label;
    text.position.set(x, y);
    text.alpha = 1;
    this.popups.addChild(text);
    this.activePopups.push({ text, age: 0 });
  }

  private updatePopups(dt: number): void {
    for (let i = this.activePopups.length - 1; i >= 0; i--) {
      const p = this.activePopups[i] as { text: Text; age: number };
      p.age += dt;
      p.text.y -= dt * 14;
      p.text.alpha = Math.max(0, 1 - p.age / 0.9);
      if (p.age >= 0.9) {
        this.popups.removeChild(p.text);
        this.popupPool.push(p.text);
        this.activePopups.splice(i, 1);
      }
    }
  }

  private updateCamera(dt: number): void {
    const t = this.camTarget;
    if (!t || this.holdCamera) return;
    const k = 1 - Math.exp(-dt * 5);
    const c = this.camera;
    const scale = c.scale + (t.scale - c.scale) * k;
    const x = c.x + (t.x - c.x) * k;
    const y = c.y + (t.y - c.y) * k;
    if (Math.abs(scale - t.scale) < 0.002 && Math.abs(x - t.x) < 0.5 && Math.abs(y - t.y) < 0.5) {
      c.set(t.scale, t.x, t.y);
      this.camTarget = null;
    } else c.set(scale, x, y);
  }

  private redrawStatic(): void {
    const s = this.session;
    if (!s) return;
    drawTerrain(this.terrain, s.sim.grid, this.theme, this.options.showGrid);
    this.drawLabels();
    this.drawOutside();
    this.networkChanged();
  }

  networkChanged(): void {
    const s = this.session;
    if (!s || !this.paths) return;
    this.paths.clear();
    drawRoads(this.roads, s.sim.grid, this.theme);
    this.drawSigns();
    drawBuildings(this.buildings, s.sim.buildings, s.sim.grid.width, this.theme);
    this.overlayTimer = 0;
  }

  /** Call after one or more simulation steps. */
  captureVehicles(): void {
    const s = this.session;
    if (!s || !this.paths) return;
    const theme = this.theme;
    this.vehicles.capture(s.sim.vehicles, s.sim.graph, this.paths, (v) => {
      // Highway traffic is grey: it belongs to no colour group.
      if (s.sim.highwayTrip(v)) return theme.through;
      return groupColor(theme, s.sim.buildingById(v.destination)?.color ?? 0);
    });
  }

  setPreview(cells: readonly PreviewCell[] | null, erase: boolean): void {
    if (!this.session || !cells) {
      this.preview.clear();
      return;
    }
    drawPreview(this.preview, this.session.sim.grid, cells, this.theme, erase);
  }

  setHover(cell: number): void {
    if (!this.session) return;
    drawHover(this.hover, this.session.sim.grid, cell, this.theme);
  }

  render(alpha: number, frameSeconds: number): void {
    // A new week brings a new season: repaint the map.
    if (this.session && seasonOf(this.session.week) !== this.season) {
      this.applyTheme();
      this.redrawStatic();
    }
    const s = this.session;
    this.time += frameSeconds;
    this.updateCamera(frameSeconds);
    this.updatePopups(frameSeconds);
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.scale);
    if (s && this.paths) {
      this.vehicles.update(alpha);
      this.ambience.update(frameSeconds, this.options.reduceMotion);
      const pulse = this.options.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(this.time * 4);
      this.overlayTimer -= frameSeconds;
      if (this.overlayTimer <= 0) {
        this.overlayTimer = 0.25;
        const graph = s.sim.graph;
        drawBuildingStatus(
          this.status,
          s.sim.buildings,
          s.sim.time,
          this.theme,
          pulse,
          s.sim.grid.width,
          (b) => {
            const node = graph.node(b.door);
            return node !== undefined && node.degree > 0;
          },
        );
        if (this.trafficOverlay) drawTraffic(this.traffic, s.sim, this.paths, this.theme);
        else this.traffic.clear();
      }
      drawGridlocks(this.gridlocks, s.sim, this.theme, pulse);
      drawSignals(this.lights, s.sim, this.theme);
      this.drawHint(pulse);
      drawSelection(
        this.selection,
        s.sim,
        this.paths,
        this.selectedVehicle,
        this.selectedBuilding,
        this.theme,
      );
    }
    this.app.render();
  }

  /** Forces the traffic layer to refresh on the next frame. */
  refreshOverlay(): void {
    this.overlayTimer = 0;
  }

  resize(): void {
    this.app.resize();
    this.camera.setViewport(this.host.clientWidth, this.host.clientHeight);
  }

  /** Cell under a client (CSS pixel) position, or -1. */
  cellAt(clientX: number, clientY: number): number {
    const s = this.session;
    if (!s) return -1;
    const rect = this.canvas.getBoundingClientRect();
    const w = this.camera.toWorld(clientX - rect.left, clientY - rect.top);
    const x = Math.floor(w.x / GEOM.cellSize);
    const y = Math.floor(w.y / GEOM.cellSize);
    return s.sim.grid.inBounds(x, y) ? s.sim.grid.idx(x, y) : -1;
  }

  /** Client position of a cell centre. */
  cellToClient(cell: number): { x: number; y: number } {
    const s = this.session;
    const rect = this.canvas.getBoundingClientRect();
    if (!s) return { x: 0, y: 0 };
    const g = s.sim.grid;
    const p = this.camera.toScreen((g.cx(cell) + 0.5) * GEOM.cellSize, (g.cy(cell) + 0.5) * GEOM.cellSize);
    return { x: p.x + rect.left, y: p.y + rect.top };
  }

  pickVehicle(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const w = this.camera.toWorld(clientX - rect.left, clientY - rect.top);
    return this.vehicles.pick(w.x, w.y, Math.max(5, 14 / this.camera.scale));
  }

  /** True when a client point is on (or right next to) the flying gull. */
  pickGull(clientX: number, clientY: number): boolean {
    const g = this.ambience.gullAt();
    if (!g) return false;
    const rect = this.canvas.getBoundingClientRect();
    const w = this.camera.toWorld(clientX - rect.left, clientY - rect.top);
    return Math.hypot(w.x - g.x, w.y - g.y) <= Math.max(9, 24 / this.camera.scale);
  }

  get visibleVehicles(): number {
    return this.vehicles.count;
  }

  destroy(): void {
    this.vehicles.destroy();
    this.app.destroy(true, { children: true });
  }
}
