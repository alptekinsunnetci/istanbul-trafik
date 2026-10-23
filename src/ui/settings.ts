import { DEFAULT_SETTINGS, type ReduceMotion, type Settings } from '../persistence/save-schema';
import type { WriteResult } from '../persistence/save-manager';
import { Modal } from './accessibility';
import { button, h } from './dom';

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
  const modal = new Modal('Ayarlar', true, () => close());
  modal.panel.id = 'settings-dialog';
  const close = (): void => {
    modal.close();
    onClose();
  };
  const volume = range(
    'set-volume',
    'Ses düzeyi',
    0,
    100,
    5,
    Math.round(current.volume * 100),
    (v) => `%${v}`,
  );
  const music = range('set-music', 'Müzik', 0, 100, 5, Math.round(current.music * 100), (v) =>
    v === 0 ? 'Kapalı' : `%${v}`,
  );
  const muted = checkbox('set-muted', 'Sesleri kapat', current.muted);
  const motionSelect = h('select', { id: 'set-motion' });
  for (const [v, label] of [
    ['system', 'Sistem tercihine uy'],
    ['on', 'Hareketi azalt'],
    ['off', 'Tüm animasyonlar'],
  ] as const) {
    const o = h('option', { value: v, text: label });
    if (v === current.reduceMotion) o.selected = true;
    motionSelect.append(o);
  }
  const contrast = checkbox('set-contrast', 'Yüksek kontrast', current.highContrast);
  const grid = checkbox('set-grid', 'Izgara noktalarını göster', current.showGrid);
  const pan = range(
    'set-pan',
    'Klavye ile kaydırma hızı',
    50,
    200,
    10,
    Math.round(current.panSpeed * 100),
    (v) => `%${v}`,
  );
  const invert = checkbox('set-invert', 'Tekerlek yakınlaştırma yönünü ters çevir', current.invertZoom);
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
  });

  const save = button(
    'Kaydet',
    () => {
      const r = apply(read());
      if (r.ok) {
        status.textContent = 'Ayarlar kaydedildi.';
        status.dataset.kind = 'ok';
      } else {
        status.textContent = `Ayarlar uygulandı ancak kaydedilemedi: ${r.error ?? ''}`;
        status.dataset.kind = 'error';
      }
    },
    { className: 'pill pill-primary', id: 'btn-save-settings' },
  );
  const reset = button(
    'Varsayılanlar',
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
      status.textContent = 'Varsayılan değerler yüklendi; uygulamak için Kaydet’e basın.';
      status.dataset.kind = '';
    },
    { className: 'pill pill-quiet' },
  );
  const closeBtn = button('Kapat', close, { className: 'pill', id: 'btn-close-settings' });

  const soundFields = h('fieldset', {}, h('legend', { text: 'Ses' }), volume.row, music.row, muted.row);
  if (!soundSupported) {
    volume.input.disabled = true;
    music.input.disabled = true;
    muted.input.disabled = true;
    soundFields.append(
      h('p', { class: 'field-help', text: 'Bu tarayıcı Web Audio desteklemiyor; sesler çalınamaz.' }),
    );
  }
  volume.input.dataset.autofocus = '';
  modal.panel.append(
    soundFields,
    h(
      'fieldset',
      {},
      h('legend', { text: 'Görüntü' }),
      h('div', { class: 'field' }, h('label', { for: 'set-motion', text: 'Animasyonlar' }), motionSelect),
      contrast.row,
      grid.row,
    ),
    h('fieldset', {}, h('legend', { text: 'Kontroller' }), pan.row, invert.row),
    status,
    h('div', { class: 'dialog-actions' }, reset, closeBtn, save),
  );
  modal.open(host);
  return modal;
}
