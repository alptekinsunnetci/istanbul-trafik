/** 2D camera: world metres → screen pixels via a uniform scale and an offset. */
export class Camera {
  /** Pixels per metre. */
  scale = 1;
  /** Screen position of the world origin. */
  x = 0;
  y = 0;
  minScale = 0.25;
  maxScale = 8;
  private worldW = 1;
  private worldH = 1;
  private viewW = 1;
  private viewH = 1;

  setWorld(width: number, height: number): void {
    this.worldW = width;
    this.worldH = height;
  }

  setViewport(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    this.clamp();
  }

  /** Fits the whole world into the viewport, leaving room for the interface. */
  fit(insetTop = 0, insetBottom = 0): void {
    const h = Math.max(100, this.viewH - insetTop - insetBottom);
    const s = Math.min(this.viewW / this.worldW, h / this.worldH) * 0.96;
    this.minScale = Math.min(s * 0.6, 0.6);
    this.scale = s;
    this.x = (this.viewW - this.worldW * s) / 2;
    this.y = insetTop + (h - this.worldH * s) / 2;
  }

  /** Camera values that would centre a world rectangle between the insets (not applied). */
  computeFit(
    x: number,
    y: number,
    w: number,
    h: number,
    insetTop = 0,
    insetBottom = 0,
  ): { scale: number; x: number; y: number } {
    const vh = Math.max(100, this.viewH - insetTop - insetBottom);
    const s = Math.max(this.minScale, Math.min(this.maxScale, Math.min(this.viewW / w, vh / h) * 0.94));
    return { scale: s, x: this.viewW / 2 - (x + w / 2) * s, y: insetTop + vh / 2 - (y + h / 2) * s };
  }

  /** Centres a world rectangle in the free area between the insets. */
  fitRect(x: number, y: number, w: number, h: number, insetTop = 0, insetBottom = 0): void {
    const t = this.computeFit(x, y, w, h, insetTop, insetBottom);
    this.set(t.scale, t.x, t.y);
  }

  set(scale: number, x: number, y: number): void {
    this.scale = scale;
    this.x = x;
    this.y = y;
    this.clamp();
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.x) / this.scale, y: (sy - this.y) / this.scale };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.x, y: wy * this.scale + this.y };
  }

  pan(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  /** Zooms by `factor` keeping the screen point (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    const w = this.toWorld(sx, sy);
    this.scale = next;
    this.x = sx - w.x * next;
    this.y = sy - w.y * next;
    this.clamp();
  }

  /** Keeps at least a quarter of the viewport covered by the map. */
  private clamp(): void {
    const ww = this.worldW * this.scale;
    const wh = this.worldH * this.scale;
    const mx = this.viewW * 0.75;
    const my = this.viewH * 0.75;
    this.x = Math.min(this.viewW - (this.viewW - mx), Math.max(-ww + this.viewW - mx, this.x));
    this.y = Math.min(this.viewH - (this.viewH - my), Math.max(-wh + this.viewH - my, this.y));
  }
}
