import { L } from '../core/i18n';
/**
 * Explicit application states. Settings and help are overlays that can be
 * opened on top of most states; while an overlay is open during play the
 * simulation is paused.
 */
export type AppState = 'loading' | 'menu' | 'ready' | 'playing' | 'paused' | 'gameover' | 'error';
export type Overlay = 'none' | 'settings' | 'help';

const TRANSITIONS: Record<AppState, readonly AppState[]> = {
  loading: ['menu', 'error'],
  menu: ['ready', 'paused', 'error'],
  ready: ['playing', 'menu', 'ready', 'error'],
  playing: ['paused', 'gameover', 'ready', 'menu', 'error'],
  paused: ['playing', 'ready', 'menu', 'gameover', 'error'],
  gameover: ['ready', 'menu', 'error'],
  error: ['menu', 'loading'],
};

export class AppStateMachine {
  private current: AppState = 'loading';
  private overlayState: Overlay = 'none';
  private listeners = new Set<(state: AppState, overlay: Overlay) => void>();

  get state(): AppState {
    return this.current;
  }

  get overlay(): Overlay {
    return this.overlayState;
  }

  /** The simulation advances only while playing with no overlay open. */
  get simulationRunning(): boolean {
    return this.current === 'playing' && this.overlayState === 'none';
  }

  can(next: AppState): boolean {
    return TRANSITIONS[this.current].includes(next);
  }

  go(next: AppState): void {
    if (!this.can(next)) throw new Error(`Geçersiz durum geçişi: ${this.current} → ${next}`);
    this.current = next;
    this.emit();
  }

  setOverlay(overlay: Overlay): void {
    this.overlayState = overlay;
    this.emit();
  }

  onChange(fn: (state: AppState, overlay: Overlay) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current, this.overlayState);
  }
}

export const STATE_LABELS: Record<AppState, string> = {
  loading: L('Yükleniyor', 'Loading'),
  menu: L('Ana menü', 'Main menu'),
  ready: L('Hazır', 'Ready'),
  playing: L('Oyun sürüyor', 'Playing'),
  paused: L('Duraklatıldı', 'Paused'),
  gameover: L('Oyun bitti', 'Game over'),
  error: L('Hata', 'Error'),
};
