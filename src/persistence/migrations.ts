import { DEFAULT_SETTINGS, SETTINGS_VERSION } from './save-schema';

/**
 * Upgrades older stored formats to the current version. Unknown future
 * versions are rejected so that a newer build's data is never misread.
 */
export function migrateSettings(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const o = raw as Record<string, unknown>;
  // Pre-release builds stored settings without a version and only sound fields.
  if (o.version === undefined) return { ...DEFAULT_SETTINGS, ...o, version: SETTINGS_VERSION };
  if (o.version === SETTINGS_VERSION) return { ...DEFAULT_SETTINGS, ...o };
  throw new Error(`Bilinmeyen ayar sürümü: ${JSON.stringify(o.version)}`);
}

export function migrateSave(raw: unknown): unknown {
  // Versions 1–2 belong to earlier rule sets (asphalt budget, satisfaction, overflow in seconds),
  // version 3 to maps without rivers and highways; none of them can be mapped onto the current
  // maps, so they are discarded with a notice.
  const version =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).version : undefined;
  if (version === 1 || version === 2 || version === 3) {
    throw new Error('Kayıt oyunun eski bir sürümüne ait');
  }
  return raw;
}
