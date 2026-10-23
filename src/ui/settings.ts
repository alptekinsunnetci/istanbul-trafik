import { DEFAULT_SETTINGS, type ReduceMotion, type Settings } from '../persistence/save-schema';
import type { WriteResult } from '../persistence/save-manager';
import { Modal } from './accessibility';
import { button, h } from './dom';
import { L } from '../core/i18n';

function checkbox(
  id: string,
  label: string,
  checked: boolean,
): { row: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { id, type: 'checkbox' });
  input.checked = checked;
  return {
    row: h('div', { class: 'field field-check' }, input, h('label', { for: id, text: label })),
    input,
  };
}

function range(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
) {
  const input = h('input', { id, type: 'range', min, max, step });
  input.value = String(value);
  const out = h('output', { for: id, text: format(value) });
  input.addEventListener('input', () => (out.textContent = format(Number(input.value))));
  return {
    row: h(
      'div',
      { class: 'field' },
      h('label', { for: id, text: label }),
      h('div', { class: 'range-row' }, input, out),
    ),
    input,
  };
}

/**
 * Settings dialog. Changes are applied and stored when "Kaydet" is pressed;
 * a failed write is reported in the dialog instead of being ignored.
 */
export function openSettings(
  host: HTMLElement,
  current: Settings,
  apply: (s: Settings) => WriteResult,
  onClose: () => void,
  soundSupported: boolean,
): Modal {
  const modal = new Modal(L('Ayarlar', 'Settings'), true, () => close());
  modal.panel.id = 'settings-dialog';
  const close = (): void => {
    modal.close();
    onClose();
  };
  const volume = range(
    'set-volume',
    L('Ses düzeyi', 'Volume'),
    0,
    100,
    5,
    Math.round(current.volume * 100),
    (v) => `%${v}`,
  );
  const music = range('set-music', L('Müzik', 'Music'), 0, 100, 5, Math.round(current.music * 100), (v) =>
    v === 0 ? L('Kapalı', 'Off') : `%${v}`,
  );
  const muted = checkbox('set-muted', L('Sesleri kapat', 'Mute'), current.muted);
  const motionSelect = h('select', { id: 'set-motion' });
  for (const [v, label] of [
    ['system', L('Sistem tercihine uy', 'Follow system setting')],
    ['on', L('Hareketi azalt', 'Reduce motion')],
    ['off', L('Tüm animasyonlar', 'All animations')],
  ] as const) {
    const o = h('option', { value: v, text: label });
    if (v === current.reduceMotion) o.selected = true;
    motionSelect.append(o);
  }
  const contrast = checkbox('set-contrast', L('Yüksek kontrast', 'High contrast'), current.highContrast);
  const grid = checkbox('set-grid', L('Izgara noktalarını göster', 'Show the grid'), current.showGrid);
  const pan = range(
    'set-pan',
    L('Klavye ile kaydırma hızı', 'Keyboard pan speed'),
    50,
    200,
    10,
    Math.round(current.panSpeed * 100),
    (v) => `%${v}`,
  );
  const invert = checkbox(
    'set-invert',
    L('Tekerlek yakınlaştırma yönünü ters çevir', 'Invert wheel zoom'),
    current.invertZoom,
  );
  const langSelect = h('select', { id: 'set-lang' });
  for (const [v, label] of [
    ['tr', 'Türkçe'],
    ['en', 'English'],
  ] as const) {
    const o = h('option', { value: v, text: label });
    if (v === current.lang) o.selected = true;
    langSelect.append(o);
  }
  const status = h('p', { class: 'field-status', role: 'status' });

  const read = (): Settings => ({
    version: DEFAULT_SETTINGS.version,
    volume: Math.min(1, Math.max(0, Number(volume.input.value) / 100)),
    music: Math.min(1, Math.max(0, Number(music.input.value) / 100)),
    muted: muted.input.checked,
    reduceMotion: motionSelect.value as ReduceMotion,
    highContrast: contrast.input.checked,
    showGrid: grid.input.checked,
    panSpeed: Math.min(2, Math.max(0.5, Number(pan.input.value) / 100)),
    invertZoom: invert.input.checked,
    mode: current.mode,
    seenIntro: current.seenIntro,
    lang: langSelect.value === 'en' ? 'en' : 'tr',
  });

  const save = button(
    L('Kaydet', 'Save'),
    () => {
      const next = read();
      const r = apply(next);
      // A new language takes effect after a reload (labels are made at start-up).
      if (r.ok && next.lang !== current.lang) {
        window.location.reload();
        return;
      }
      if (r.ok) {
        status.textContent = L('Ayarlar kaydedildi.', 'Settings saved.');
        status.dataset.kind = 'ok';
      } else {
        status.textContent = `${L('Ayarlar uygulandı ancak kaydedilemedi', 'Settings applied but could not be saved')}: ${r.error ?? ''}`;
        status.dataset.kind = 'error';
      }
    },
    { className: 'pill pill-primary', id: 'btn-save-settings' },
  );
  const reset = button(
    L('Varsayılanlar', 'Defaults'),
    () => {
      volume.input.value = String(DEFAULT_SETTINGS.volume * 100);
      volume.input.dispatchEvent(new Event('input'));
      music.input.value = String(DEFAULT_SETTINGS.music * 100);
      music.input.dispatchEvent(new Event('input'));
      muted.input.checked = DEFAULT_SETTINGS.muted;
      motionSelect.value = DEFAULT_SETTINGS.reduceMotion;
      contrast.input.checked = DEFAULT_SETTINGS.highContrast;
      grid.input.checked = DEFAULT_SETTINGS.showGrid;
      pan.input.value = String(DEFAULT_SETTINGS.panSpeed * 100);
      pan.input.dispatchEvent(new Event('input'));
      invert.input.checked = DEFAULT_SETTINGS.invertZoom;
      status.textContent = L(
        'Varsayılan değerler yüklendi; uygulamak için Kaydet’e basın.',
        'Defaults loaded; press Save to apply.',
      );
      status.dataset.kind = '';
    },
    { className: 'pill pill-quiet' },
  );
  const closeBtn = button(L('Kapat', 'Close'), close, { className: 'pill', id: 'btn-close-settings' });

  const soundFields = h(
    'fieldset',
    {},
    h('legend', { text: L('Ses', 'Sound') }),
    volume.row,
    music.row,
    muted.row,
  );
  if (!soundSupported) {
    volume.input.disabled = true;
    music.input.disabled = true;
    muted.input.disabled = true;
    soundFields.append(
      h('p', {
        class: 'field-help',
        text: L(
          'Bu tarayıcı Web Audio desteklemiyor; sesler çalınamaz.',
          'This browser does not support Web Audio; no sound can play.',
        ),
      }),
    );
  }
  volume.input.dataset.autofocus = '';
  modal.panel.append(
    soundFields,
    h(
      'fieldset',
      {},
      h('legend', { text: L('Görüntü', 'Display') }),
      h('div', { class: 'field' }, h('label', { for: 'set-lang', text: 'Dil / Language' }), langSelect),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'set-motion', text: L('Animasyonlar', 'Animations') }),
        motionSelect,
      ),
      contrast.row,
      grid.row,
    ),
    h('fieldset', {}, h('legend', { text: L('Kontroller', 'Controls') }), pan.row, invert.row),
    status,
    h('div', { class: 'dialog-actions' }, reset, closeBtn, save),
  );
  modal.open(host);
  return modal;
}
