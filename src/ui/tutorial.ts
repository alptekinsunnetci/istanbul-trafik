import { button, h } from './dom';
import { L } from '../core/i18n';

export interface CoachAction {
  label: string;
  run: () => void;
}

/**
 * Small coaching card for the guided "learn by playing" game: one short
 * sentence per step, an optional action and a skip button.
 */
export class CoachCard {
  readonly root = h('section', { class: 'coach', id: 'coach', 'aria-live': 'polite', hidden: true });
  private stepEl = h('span', { class: 'coach-step' });
  private textEl = h('p', { class: 'coach-text' });
  private actions = h('div', { class: 'coach-actions' });

  constructor(onSkip: () => void) {
    const skip = button(L('Geç', 'Skip'), onSkip, { className: 'link', id: 'btn-coach-skip' });
    this.root.append(h('div', { class: 'coach-head' }, this.stepEl, skip), this.textEl, this.actions);
  }

  show(step: number, total: number, text: string, action?: CoachAction): void {
    this.root.hidden = false;
    this.root.dataset.step = String(step);
    this.stepEl.textContent = `${step}/${total}`;
    this.textEl.textContent = text;
    this.actions.replaceChildren();
    if (action)
      this.actions.append(
        button(action.label, action.run, { className: 'pill pill-primary', id: 'btn-coach-next' }),
      );
  }

  hide(): void {
    this.root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
