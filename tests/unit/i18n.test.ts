import { afterEach, describe, expect, it } from 'vitest';
import { L, detectLang, getLang, setLang, t } from '../../src/core/i18n';

describe('languages', () => {
  afterEach(() => setLang('tr'));

  it('pick Turkish or English from the browser, Turkish when unsure', () => {
    expect(detectLang(['tr-TR', 'en-US'])).toBe('tr');
    expect(detectLang(['en-GB'])).toBe('en');
    expect(detectLang(['de-DE', 'en-US'])).toBe('en');
    expect(detectLang(['fr-FR'])).toBe('tr');
  });

  it('switch every text and label', () => {
    expect(L('Geri al', 'Undo')).toBe('Geri al');
    expect(t('Kış')).toBe('Kış');
    setLang('en');
    expect(getLang()).toBe('en');
    expect(L('Geri al', 'Undo')).toBe('Undo');
    expect(t('Kış')).toBe('Winter');
    expect(t('Bilinmeyen')).toBe('Bilinmeyen');
  });
});
