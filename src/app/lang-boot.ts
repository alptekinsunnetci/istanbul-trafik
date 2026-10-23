/**
 * Picks the interface language before anything else is loaded (labels made
 * at load time depend on it): `?lang=` in the address, else the saved
 * setting, else the browser's language.
 */
import { type Lang, detectLang, getLang, setLang } from '../core/i18n';

function savedLang(): Lang | null {
  try {
    const raw = localStorage.getItem('istanbul-trafik:settings');
    if (!raw) return null;
    const o = JSON.parse(raw) as { lang?: unknown };
    return o.lang === 'en' || o.lang === 'tr' ? o.lang : null;
  } catch {
    return null;
  }
}

const forced = new URLSearchParams(location.search).get('lang');
setLang(
  forced === 'en' || forced === 'tr'
    ? forced
    : (savedLang() ??
        detectLang(navigator.languages.length > 0 ? navigator.languages : [navigator.language])),
);
document.documentElement.lang = getLang();
