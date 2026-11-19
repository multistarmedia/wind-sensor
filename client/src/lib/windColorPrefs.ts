// Browser-local wind colour scale prefs (palette + continuous max colour speed).

import { useEffect, useState } from 'react';
import { BEAUFORT_EDGES_MS } from '../../../shared/wind';
import {
  clampMaxSpeedMs, DEFAULT_MAX_SPEED_MS, type WindPaletteId,
} from '../../../shared/windColors';

const KEY = 'aio2.windColorScale.v2';
const LEGACY_KEY = 'aio2.windColorScale.v1';
const CHANGE_EVENT = 'aio2.windColorScale';

export interface WindColorPrefs {
  paletteId: WindPaletteId;
  /** Speed (m/s) that maps to the top palette colour; stronger winds reuse it. */
  maxSpeedMs: number;
}

export const DEFAULT_WIND_COLOR_PREFS: WindColorPrefs = {
  paletteId: 'classic',
  maxSpeedMs: DEFAULT_MAX_SPEED_MS,
};

const PALETTE_IDS: WindPaletteId[] = ['classic', 'cool', 'warm'];

function parsePrefs(raw: string): WindColorPrefs | null {
  try {
    const o = JSON.parse(raw) as Partial<WindColorPrefs> & { maxBand?: number };
    const paletteId = PALETTE_IDS.includes(o.paletteId as WindPaletteId)
      ? (o.paletteId as WindPaletteId)
      : 'classic';
    if (typeof o.maxSpeedMs === 'number') {
      return { paletteId, maxSpeedMs: clampMaxSpeedMs(o.maxSpeedMs) };
    }
    // Migrate discrete Beaufort maxBand → continuous max speed at that band’s edge.
    if (typeof o.maxBand === 'number' && o.maxBand >= 1 && o.maxBand <= 12) {
      const i = Math.round(o.maxBand) - 1;
      return { paletteId, maxSpeedMs: clampMaxSpeedMs(BEAUFORT_EDGES_MS[i]!) };
    }
    return { paletteId, maxSpeedMs: DEFAULT_MAX_SPEED_MS };
  } catch {
    return null;
  }
}

export function loadWindColorPrefs(): WindColorPrefs {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return { ...DEFAULT_WIND_COLOR_PREFS };
    return parsePrefs(raw) ?? { ...DEFAULT_WIND_COLOR_PREFS };
  } catch {
    return { ...DEFAULT_WIND_COLOR_PREFS };
  }
}

export function saveWindColorPrefs(prefs: WindColorPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      paletteId: prefs.paletteId,
      maxSpeedMs: clampMaxSpeedMs(prefs.maxSpeedMs),
    }));
  } catch {
    // ignore
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: prefs }));
  }
}

/** Shared wind colour prefs; stays in sync when Wind tile (or any caller) updates them. */
export function useWindColorPrefs(): [
  WindColorPrefs,
  (next: Partial<Pick<WindColorPrefs, 'paletteId' | 'maxSpeedMs'>>) => void,
] {
  const [prefs, setPrefs] = useState(loadWindColorPrefs);

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<WindColorPrefs>).detail;
      if (detail?.paletteId) setPrefs(detail);
      else setPrefs(loadWindColorPrefs());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === LEGACY_KEY) setPrefs(loadWindColorPrefs());
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function update(next: Partial<Pick<WindColorPrefs, 'paletteId' | 'maxSpeedMs'>>) {
    setPrefs((prev) => {
      const merged: WindColorPrefs = {
        paletteId: next.paletteId ?? prev.paletteId,
        maxSpeedMs: clampMaxSpeedMs(next.maxSpeedMs ?? prev.maxSpeedMs),
      };
      saveWindColorPrefs(merged);
      return merged;
    });
  }

  return [prefs, update];
}
