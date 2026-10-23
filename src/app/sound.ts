/**
 * Synthesised sound effects (no audio files). The AudioContext is created
 * lazily on the first user gesture, as browsers require.
 */
export type SoundName =
  | 'click'
  | 'build'
  | 'erase'
  | 'arrive'
  | 'fail'
  | 'week'
  | 'gameover'
  | 'invalid'
  | 'gull'
  | 'horn'
  | 'collect'
  | 'ferry';

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
  // A gull: two falling, slightly raspy cries.
  gull: [
    { freq: 1500, to: 900, dur: 0.2, type: 'triangle', gain: 0.1 },
    { freq: 1480, to: 880, dur: 0.2, type: 'sawtooth', gain: 0.025 },
    { freq: 1400, to: 820, dur: 0.24, type: 'triangle', gain: 0.09, delay: 0.27 },
    { freq: 1380, to: 800, dur: 0.24, type: 'sawtooth', gain: 0.02, delay: 0.27 },
  ],
  // A car horn: a short two-tone honk, twice.
  horn: [
    { freq: 415, dur: 0.22, type: 'square', gain: 0.045 },
    { freq: 523, dur: 0.22, type: 'square', gain: 0.035 },
    { freq: 415, dur: 0.14, type: 'square', gain: 0.04, delay: 0.3 },
    { freq: 523, dur: 0.14, type: 'square', gain: 0.03, delay: 0.3 },
  ],
  // A ferry horn: one long and one short low blast.
  ferry: [
    { freq: 174, dur: 1.1, type: 'sawtooth', gain: 0.05 },
    { freq: 220, dur: 1.1, type: 'triangle', gain: 0.07 },
    { freq: 174, dur: 0.45, type: 'sawtooth', gain: 0.05, delay: 1.3 },
    { freq: 220, dur: 0.45, type: 'triangle', gain: 0.07, delay: 1.3 },
  ],
  collect: [
    { freq: 660, to: 990, dur: 0.12, type: 'triangle', gain: 0.25 },
    { freq: 1320, dur: 0.12, type: 'triangle', gain: 0.18, delay: 0.11 },
  ],
  gameover: [
    { freq: 392, dur: 0.2, type: 'triangle', gain: 0.3 },
    { freq: 311, dur: 0.22, type: 'triangle', gain: 0.3, delay: 0.2 },
    { freq: 262, dur: 0.4, type: 'triangle', gain: 0.3, delay: 0.42 },
  ],
};

/**
 * Calm generative background music: a soft drone and a slow melody on the
 * Hicaz makam (D, E♭, F♯, G, A, B♭, C), with a gentle echo. It never repeats
 * exactly and has no audio files.
 */
const HICAZ = [293.66, 311.13, 369.99, 392.0, 440.0, 466.16, 523.25, 587.33];

class Music {
  private timer: number | null = null;
  private out: GainNode | null = null;
  private step = 0;
  private note = 4;

  constructor(private readonly ctx: AudioContext) {}

  start(volume: number): void {
    this.setVolume(volume);
    if (this.timer !== null) return;
    const ctx = this.ctx;
    if (!this.out) {
      this.out = ctx.createGain();
      const echo = ctx.createDelay(1);
      echo.delayTime.value = 0.42;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.32;
      this.out.connect(ctx.destination);
      this.out.connect(echo);
      echo.connect(feedback).connect(echo);
      echo.connect(ctx.destination);
    }
    this.setVolume(volume);
    this.timer = window.setInterval(() => this.tick(), 650);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  setVolume(volume: number): void {
    if (this.out) this.out.gain.setTargetAtTime(volume * 0.5, this.ctx.currentTime, 0.3);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType): void {
    const ctx = this.ctx;
    const out = this.out;
    if (!out) return;
    const t = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.4, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private tick(): void {
    // Drone on D every eight beats, a melody note on most beats, rests in between.
    if (this.step % 8 === 0) {
      this.tone(HICAZ[0]! / 2, 5.5, 0.05, 'sine');
      this.tone(HICAZ[4]! / 2, 5.5, 0.03, 'sine');
    }
    if (Math.random() < 0.7) {
      const move = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]!;
      this.note = Math.min(HICAZ.length - 1, Math.max(0, this.note + move));
      this.tone(HICAZ[this.note]!, 1.4, 0.045, 'triangle');
    }
    this.step++;
  }
}

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private music: Music | null = null;
  /** Background music volume (0 = off). */
  musicVolume = 0.4;
  private musicWanted = false;
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
    this.updateMusic();
  }

  /** Music plays only while the game runs; call when that changes. */
  setMusic(playing: boolean): void {
    this.musicWanted = playing;
    this.updateMusic();
  }

  /** Applies volume and mute changes to the music. */
  updateMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const on = this.musicWanted && !this.muted && this.musicVolume > 0 && this.volume > 0;
    if (!on) {
      this.music?.stop();
      return;
    }
    this.music ??= new Music(ctx);
    this.music.start(this.musicVolume * this.volume);
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
    this.music?.stop();
    this.music = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
