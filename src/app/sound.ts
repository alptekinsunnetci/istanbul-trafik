/**
 * Synthesised sound effects (no audio files). The AudioContext is created
 * lazily on the first user gesture, as browsers require.
 */
export type SoundName = 'click' | 'build' | 'erase' | 'arrive' | 'fail' | 'week' | 'gameover' | 'invalid';

interface Tone {
  freq: number;
  to?: number;
  dur: number;
  type: OscillatorType;
  gain: number;
  delay?: number;
}

const SOUNDS: Record<SoundName, Tone[]> = {
  click: [{ freq: 660, dur: 0.05, type: 'triangle', gain: 0.25 }],
  build: [{ freq: 300, to: 420, dur: 0.08, type: 'triangle', gain: 0.3 }],
  erase: [{ freq: 360, to: 200, dur: 0.1, type: 'triangle', gain: 0.3 }],
  arrive: [{ freq: 880, dur: 0.07, type: 'sine', gain: 0.12 }],
  fail: [{ freq: 220, to: 150, dur: 0.22, type: 'sawtooth', gain: 0.12 }],
  invalid: [{ freq: 180, dur: 0.12, type: 'square', gain: 0.08 }],
  week: [
    { freq: 523, dur: 0.1, type: 'triangle', gain: 0.25 },
    { freq: 784, dur: 0.16, type: 'triangle', gain: 0.25, delay: 0.1 },
  ],
  gameover: [
    { freq: 392, dur: 0.2, type: 'triangle', gain: 0.3 },
    { freq: 311, dur: 0.22, type: 'triangle', gain: 0.3, delay: 0.2 },
    { freq: 262, dur: 0.4, type: 'triangle', gain: 0.3, delay: 0.42 },
  ],
};

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private lastPlayed = new Map<SoundName, number>();
  volume = 0.6;
  muted = false;
  /** False when the browser offers no Web Audio support. */
  readonly supported = typeof window !== 'undefined' && typeof window.AudioContext === 'function';

  /** Must be called from a user gesture handler. */
  unlock(): void {
    if (!this.supported) return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch (err) {
        console.warn('Ses başlatılamadı', err);
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || this.volume <= 0 || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Throttle repeated effects (e.g. many arrivals in one frame).
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.09) return;
    this.lastPlayed.set(name, now);
    for (const t of SOUNDS[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + (t.delay ?? 0);
      osc.type = t.type;
      osc.frequency.setValueAtTime(t.freq, start);
      if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, t.gain * this.volume), start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + t.dur + 0.02);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
