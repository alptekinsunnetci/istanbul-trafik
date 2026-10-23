import { clockText, dayPart, hourAt } from '../gameplay/daytime';
import type { AppState } from '../app/app-state';
import { ECONOMY } from '../core/constants';
import type { GameSession } from '../gameplay/game-session';
import { formatNumber, h, icon } from './dom';

export interface HudActions {
  toggleRun(): void;
  cycleSpeed(): void;
  openMenu(): void;
}

const DAYS = ['PZT', 'SAL', 'ÇAR', 'PER', 'CUM', 'CMT', 'PAZ'];
const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const RING = 2 * Math.PI * 19;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Almost invisible heads-up display drawn straight onto the map: a back
 * arrow on the left; the score, the weekday and a week clock (which also
 * pauses the game) on the right.
 */
export class Hud {
  readonly root: HTMLElement;
  private district = h('span', { class: 'hud-district' });
  private chip = h('span', { class: 'hud-paused', text: 'Duraklatıldı' });
  private score = h('strong', { id: 'hud-score', text: '0' });
  private day = h('span', { class: 'hud-day' });
  private ringFill: SVGCircleElement;
  private clockGlyph: SVGGElement;
  private runBtn: HTMLButtonElement;
  private speedBtn: HTMLButtonElement;
  private lastRunning: boolean | null = null;

  constructor(actions: HudActions) {
    const back = h('button', {
      type: 'button',
      class: 'ghost',
      id: 'btn-menu',
      'aria-label': 'Menü (Esc)',
      title: 'Menü',
    });
    back.append(icon('back', 30));
    back.addEventListener('click', () => actions.openMenu());

    // Week clock: the ring fills over the week; the centre shows pause/play.
    const clock = svg('svg', { viewBox: '0 0 48 48', width: '48', height: '48', 'aria-hidden': 'true' });
    clock.append(svg('circle', { cx: '24', cy: '24', r: '23', class: 'clock-face' }));
    clock.append(svg('circle', { cx: '24', cy: '24', r: '19', class: 'clock-track' }));
    this.ringFill = svg('circle', {
      cx: '24',
      cy: '24',
      r: '19',
      class: 'clock-fill',
      'stroke-dasharray': `0 ${RING}`,
      transform: 'rotate(-90 24 24)',
    });
    clock.append(this.ringFill);
    this.clockGlyph = svg('g', { class: 'clock-glyph' });
    clock.append(this.clockGlyph);
    this.runBtn = h('button', { type: 'button', class: 'clock', id: 'btn-run' });
    this.runBtn.append(clock);
    this.runBtn.addEventListener('click', () => actions.toggleRun());

    this.speedBtn = h('button', { type: 'button', class: 'ghost ghost-text', id: 'btn-speed' });
    this.speedBtn.addEventListener('click', () => actions.cycleSpeed());

    this.root = h(
      'header',
      { class: 'hud', 'aria-label': 'Oyun durumu' },
      h('div', { class: 'hud-left' }, back, this.district, this.chip),
      h(
        'div',
        { class: 'hud-right' },
        h(
          'span',
          { class: 'hud-score', title: 'Tamamlanan yolculuk', 'aria-label': 'Skor' },
          this.score,
          icon('car', 22),
        ),
        this.day,
        this.runBtn,
        this.speedBtn,
      ),
    );
  }

  update(session: GameSession, state: AppState, speed: number): void {
    const t = session.sim.time;
    const weekPos = (t % ECONOMY.weekLength) / ECONOMY.weekLength;
    const dayIndex = Math.min(6, Math.floor(weekPos * 7));
    this.district.textContent = session.district.name;
    const hour = hourAt(t);
    const clock = clockText(hour);
    const dayText = `${DAYS[dayIndex] ?? ''} ${clock}`;
    if (this.day.textContent !== dayText) this.day.textContent = dayText;
    this.day.title = `${session.week}. hafta, ${DAY_NAMES[dayIndex] ?? ''} ${clock} · ${dayPart(hour)}`;
    this.ringFill.setAttribute('stroke-dasharray', `${(weekPos * RING).toFixed(1)} ${RING}`);
    this.chip.hidden = state !== 'paused';
    this.score.textContent = formatNumber(session.score.score);

    const running = state === 'playing';
    if (this.lastRunning !== running) {
      this.lastRunning = running;
      const label = running ? 'Duraklat' : 'Devam';
      this.clockGlyph.replaceChildren(
        ...(running
          ? [
              svg('rect', { x: '19', y: '17', width: '3.5', height: '14', rx: '1' }),
              svg('rect', { x: '25.5', y: '17', width: '3.5', height: '14', rx: '1' }),
            ]
          : [svg('path', { d: 'M20 16.5v15l12-7.5z' })]),
      );
      this.runBtn.setAttribute('aria-label', `${label} (Boşluk)`);
      this.runBtn.title = `${session.week}. hafta — ${label} (Boşluk)`;
    }
    this.runBtn.disabled = state === 'gameover';
    const speedText = `${speed}×`;
    if (this.speedBtn.textContent !== speedText) {
      this.speedBtn.textContent = speedText;
      this.speedBtn.title = `Hız ${speedText}`;
      this.speedBtn.setAttribute('aria-label', `Hız ${speedText}, değiştirmek için tıklayın`);
      this.speedBtn.dataset.speed = String(speed);
    }
  }
}

/** Short-lived plain-text notifications, also announced to screen readers. */
export class Toasts {
  readonly root = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

  show(text: string, kind: 'info' | 'warning' | 'error' | 'success' = 'info', ms = 3000): void {
    const el = h('div', { class: `toast toast-${kind}`, text });
    this.root.append(el);
    while (this.root.children.length > 2) this.root.firstElementChild?.remove();
    window.setTimeout(() => {
      el.classList.add('toast-out');
      window.setTimeout(() => el.remove(), 250);
    }, ms);
  }

  clear(): void {
    this.root.replaceChildren();
  }
}
