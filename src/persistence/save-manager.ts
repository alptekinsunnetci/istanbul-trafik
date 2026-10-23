import type { GameSummary } from '../gameplay/game-over';
import { migrateSave, migrateSettings } from './migrations';
import {
  DEFAULT_SETTINGS,
  MAX_HISTORY,
  type Records,
  type SavedGame,
  type Settings,
  bestScoreKey,
  emptyRecords,
  parseRecords,
  parseSavedGame,
  parseSettings,
} from './save-schema';

export const STORAGE_KEYS = {
  settings: 'istanbul-trafik:settings',
  records: 'istanbul-trafik:records',
  save: 'istanbul-trafik:save',
} as const;

export interface LoadResult<T> {
  value: T;
  /** User-facing warning when stored data had to be discarded. */
  warning?: string;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

/** Storage-like interface, so tests can provide an in-memory implementation. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Returns window.localStorage if usable, otherwise null (private mode, disabled storage…). */
export function browserStorage(): KeyValueStore | null {
  try {
    const s = globalThis.localStorage;
    const probe = '__istanbul_trafik_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function describeWriteError(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'QuotaExceededError' || err.code === 22)) {
    return 'Tarayıcı depolama alanı dolu.';
  }
  return 'Tarayıcı depolamasına yazılamadı.';
}

/**
 * Local persistence of settings, records and the active game. All data lives
 * only in this browser's storage; it is not backed up anywhere and is lost
 * when the user clears site data.
 */
export class SaveManager {
  private store: KeyValueStore | null;

  constructor(store: KeyValueStore | null) {
    this.store = store;
  }

  get available(): boolean {
    return this.store !== null;
  }

  private read(key: string): unknown {
    const text = this.store?.getItem(key) ?? null;
    if (text === null) return undefined;
    return JSON.parse(text) as unknown;
  }

  private write(key: string, value: unknown): WriteResult {
    if (!this.store) return { ok: false, error: 'Tarayıcı depolaması kullanılamıyor.' };
    try {
      this.store.setItem(key, JSON.stringify(value));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeWriteError(err) };
    }
  }

  private discard(key: string): void {
    try {
      this.store?.removeItem(key);
    } catch (err) {
      console.warn('Kayıt silinemedi', err);
    }
  }

  loadSettings(): LoadResult<Settings> {
    try {
      const raw = this.read(STORAGE_KEYS.settings);
      if (raw === undefined) return { value: { ...DEFAULT_SETTINGS } };
      return { value: parseSettings(migrateSettings(raw)) };
    } catch (err) {
      console.warn('Ayarlar okunamadı', err);
      this.discard(STORAGE_KEYS.settings);
      return {
        value: { ...DEFAULT_SETTINGS },
        warning: 'Kayıtlı ayarlar bozuktu; varsayılan ayarlara dönüldü.',
      };
    }
  }

  saveSettings(settings: Settings): WriteResult {
    return this.write(STORAGE_KEYS.settings, settings);
  }

  loadRecords(): LoadResult<Records> {
    try {
      const raw = this.read(STORAGE_KEYS.records);
      if (raw === undefined) return { value: emptyRecords() };
      return { value: parseRecords(raw) };
    } catch (err) {
      console.warn('Skor kayıtları okunamadı', err);
      this.discard(STORAGE_KEYS.records);
      return { value: emptyRecords(), warning: 'Skor kayıtları bozuktu ve sıfırlandı.' };
    }
  }

  /** Adds a finished game. Returns whether it set a new best score for its district. */
  addResult(summary: GameSummary): { newBest: boolean; write: WriteResult; records: Records } {
    const records = this.loadRecords().value;
    const key = bestScoreKey(summary.districtId, summary.mode);
    const prev = records.bestScores[key] ?? 0;
    const newBest = summary.score > prev;
    if (newBest) records.bestScores[key] = summary.score;
    records.history = [summary, ...records.history].slice(0, MAX_HISTORY);
    return { newBest, write: this.write(STORAGE_KEYS.records, records), records };
  }

  /** Applies a change to the stored records (achievements, counters, daily scores) and saves them. */
  updateRecords(change: (records: Records) => void): { write: WriteResult; records: Records } {
    const records = this.loadRecords().value;
    change(records);
    return { write: this.write(STORAGE_KEYS.records, records), records };
  }

  hasSavedGame(): boolean {
    try {
      return (this.store?.getItem(STORAGE_KEYS.save) ?? null) !== null;
    } catch {
      return false;
    }
  }

  saveGame(game: SavedGame): WriteResult {
    return this.write(STORAGE_KEYS.save, game);
  }

  loadGame(): LoadResult<SavedGame | null> {
    try {
      const raw = this.read(STORAGE_KEYS.save);
      if (raw === undefined) return { value: null };
      return { value: parseSavedGame(migrateSave(raw)) };
    } catch (err) {
      console.warn('Oyun kaydı okunamadı', err);
      this.discard(STORAGE_KEYS.save);
      return { value: null, warning: 'Kayıtlı oyun bozuk veya uyumsuzdu ve silindi.' };
    }
  }

  clearGame(): void {
    this.discard(STORAGE_KEYS.save);
  }
}
