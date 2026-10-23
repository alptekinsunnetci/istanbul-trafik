import type { ReduceMotion } from '../persistence/save-schema';
import { h } from './dom';

/** Polite screen-reader announcements. */
export class Announcer {
  readonly el = h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });

  say(text: string): void {
    // Re-setting the text forces repeated messages to be announced.
    this.el.textContent = '';
    window.setTimeout(() => (this.el.textContent = text), 30);
  }
}

export function prefersReducedMotion(setting: ReduceMotion): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog with focus trap, Escape handling and focus restoration.
 */
export class Modal {
  readonly root: HTMLDivElement;
  readonly panel: HTMLDivElement;
  private previous: Element | null = null;
  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.closable) {
      e.preventDefault();
      e.stopPropagation();
      this.onEscape();
    } else if (e.key === 'Tab') {
      const items = [...this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (x) => x.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  constructor(
    title: string,
    private readonly closable: boolean,
    private readonly onEscape: () => void,
    className = '',
  ) {
    const titleId = `dlg-${Math.random().toString(36).slice(2, 9)}`;
    this.panel = h('div', {
      class: `dialog ${className}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    });
    this.panel.append(h('h2', { id: titleId, class: 'dialog-title', text: title }));
    this.root = h('div', { class: 'backdrop' }, this.panel);
  }

  open(host: HTMLElement): void {
    this.previous = document.activeElement;
    host.append(this.root);
    document.addEventListener('keydown', this.onKey, true);
    const first =
      this.panel.querySelector<HTMLElement>('[data-autofocus]') ??
      this.panel.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }

  close(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    if (this.previous instanceof HTMLElement && this.previous.isConnected) this.previous.focus();
  }
}
