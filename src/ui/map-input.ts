export interface MapInputHandlers {
  invertZoom(): boolean;
  cellAt(clientX: number, clientY: number): number;
  /** Starts a stroke; `erase` is true for the secondary (right) button. */
  strokeStart(cell: number, erase: boolean): void;
  strokeMove(cell: number): void;
  strokeEnd(commit: boolean): void;
  /** A short tap without dragging. Returns true if it was consumed (e.g. to inspect a vehicle). */
  tap(clientX: number, clientY: number): boolean;
  hover(cell: number, clientX: number, clientY: number): void;
  leave(): void;
  pan(dx: number, dy: number): void;
  zoomAt(factor: number, sx: number, sy: number): void;
  interacted(): void;
}

interface TouchPoint {
  x: number;
  y: number;
}

/**
 * Pointer handling on the map canvas: the left button (or one finger)
 * draws with the active tool, the right button erases, a short tap inspects,
 * the middle button (or two fingers) pans, and the wheel or a pinch zooms.
 */
export class MapInput {
  private mode: 'idle' | 'stroke' | 'pan' | 'pinch' = 'idle';
  private moved = false;
  private last = { x: 0, y: 0 };
  private downAt = { x: 0, y: 0 };
  private touches = new Map<number, TouchPoint>();
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private activePointer = -1;
  private readonly abort = new AbortController();

  constructor(
    private canvas: HTMLCanvasElement,
    private h: MapInputHandlers,
  ) {
    const opts = { signal: this.abort.signal };
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e), opts);
    canvas.addEventListener('pointermove', (e) => this.move(e), opts);
    canvas.addEventListener('pointerup', (e) => this.up(e, true), opts);
    canvas.addEventListener('pointercancel', (e) => this.up(e, false), opts);
    canvas.addEventListener('pointerleave', () => this.h.leave(), opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    canvas.addEventListener('wheel', (e) => this.wheel(e), { ...opts, passive: false });
  }

  private rel(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    this.h.interacted();
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // Second finger: abandon any stroke and start pinch/pan.
        if (this.mode === 'stroke') this.h.strokeEnd(false);
        this.mode = 'pinch';
        this.resetPinch();
        return;
      }
      if (this.touches.size > 2) return;
    }
    if (this.mode !== 'idle') return;
    this.canvas.setPointerCapture(e.pointerId);
    this.activePointer = e.pointerId;
    this.last = { x: e.clientX, y: e.clientY };
    this.downAt = { x: e.clientX, y: e.clientY };
    this.moved = false;
    if (e.button === 1) {
      this.mode = 'pan';
      e.preventDefault();
    } else if (e.button === 0 || e.button === 2) {
      this.mode = 'stroke';
      this.h.strokeStart(this.h.cellAt(e.clientX, e.clientY), e.button === 2);
    }
  }

  private move(e: PointerEvent): void {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.mode === 'pinch') {
        this.pinch();
        return;
      }
    }
    const cell = this.h.cellAt(e.clientX, e.clientY);
    if (this.mode === 'idle') this.h.hover(cell, e.clientX, e.clientY);
    if (e.pointerId !== this.activePointer) return;
    if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6) this.moved = true;
    if (this.mode === 'pan') {
      this.h.pan(e.clientX - this.last.x, e.clientY - this.last.y);
    } else if (this.mode === 'stroke') {
      this.h.strokeMove(cell);
      this.h.hover(cell, e.clientX, e.clientY);
    }
    this.last = { x: e.clientX, y: e.clientY };
  }

  private up(e: PointerEvent, commit: boolean): void {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.mode === 'pinch') {
        if (this.touches.size < 2) {
          this.mode = 'idle';
          this.activePointer = -1;
        } else this.resetPinch();
        return;
      }
    }
    if (e.pointerId !== this.activePointer) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.mode === 'stroke') {
      const consumed = commit && !this.moved && this.h.tap(e.clientX, e.clientY);
      this.h.strokeEnd(commit && !consumed);
    }
    this.mode = 'idle';
    this.activePointer = -1;
  }

  private resetPinch(): void {
    const [a, b] = [...this.touches.values()] as [TouchPoint, TouchPoint];
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private pinch(): void {
    if (this.touches.size < 2) return;
    const [a, b] = [...this.touches.values()] as [TouchPoint, TouchPoint];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.h.pan(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
    if (this.pinchDist > 0 && dist > 0) {
      const p = this.rel({ clientX: mid.x, clientY: mid.y });
      this.h.zoomAt(dist / this.pinchDist, p.x, p.y);
    }
    this.pinchDist = dist;
    this.pinchMid = mid;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const dir = this.h.invertZoom() ? -1 : 1;
    const factor = Math.exp(-delta * 0.0015 * dir);
    const p = this.rel(e);
    this.h.zoomAt(factor, p.x, p.y);
  }

  /** True while a drag is in progress (used to suppress keyboard shortcuts). */
  get busy(): boolean {
    return this.mode !== 'idle';
  }

  destroy(): void {
    this.abort.abort();
  }
}
