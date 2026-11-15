// Browser-local Live console layout. Persist only when the user clicks Save layout.

import type { Layout } from 'react-grid-layout';

export type TileId = 'pressure' | 'wind' | 'temperature' | 'humidity' | 'supply' | 'rain' | 'solar';

export const TILE_IDS: TileId[] = ['pressure', 'wind', 'temperature', 'humidity', 'supply', 'rain', 'solar'];

const STORAGE_KEY = 'aio2.consoleLayout.v2';

/**
 * Default 12-col Live console layout (from the saved browser arrangement).
 */
export const DEFAULT_LAYOUT: Layout[] = [
  { i: 'pressure', x: 0, y: 0, w: 3, h: 13, minW: 2, minH: 4 },
  { i: 'wind', x: 3, y: 0, w: 5, h: 17, minW: 3, minH: 6 },
  { i: 'temperature', x: 8, y: 0, w: 4, h: 11, minW: 3, minH: 6 },
  { i: 'humidity', x: 0, y: 13, w: 3, h: 4, minW: 2, minH: 2 },
  { i: 'supply', x: 8, y: 15, w: 4, h: 2, minW: 2, minH: 2 },
  { i: 'rain', x: 8, y: 11, w: 2, h: 4, minW: 2, minH: 2 },
  { i: 'solar', x: 10, y: 11, w: 2, h: 4, minW: 2, minH: 2 },
];

/** Single-column stack for narrow viewports (drag/resize off). */
export const MOBILE_LAYOUT: Layout[] = [
  { i: 'wind', x: 0, y: 0, w: 1, h: 10, minW: 1, minH: 6, static: true },
  { i: 'pressure', x: 0, y: 10, w: 1, h: 8, minW: 1, minH: 4, static: true },
  { i: 'temperature', x: 0, y: 18, w: 1, h: 10, minW: 1, minH: 6, static: true },
  { i: 'humidity', x: 0, y: 28, w: 1, h: 4, minW: 1, minH: 2, static: true },
  { i: 'supply', x: 0, y: 32, w: 1, h: 4, minW: 1, minH: 2, static: true },
  { i: 'rain', x: 0, y: 36, w: 1, h: 4, minW: 1, minH: 2, static: true },
  { i: 'solar', x: 0, y: 40, w: 1, h: 4, minW: 1, minH: 2, static: true },
];

export function loadLayout(): Layout[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneLayout(DEFAULT_LAYOUT);
    const parsed = JSON.parse(raw) as unknown;
    const validated = validateLayout(parsed);
    return validated ?? cloneLayout(DEFAULT_LAYOUT);
  } catch {
    return cloneLayout(DEFAULT_LAYOUT);
  }
}

export function saveLayout(layout: Layout[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout.map(pickItem)));
  } catch {
    // Quota / private mode — layout still works for this session.
  }
}

function validateLayout(raw: unknown): Layout[] | null {
  if (!Array.isArray(raw) || raw.length !== TILE_IDS.length) return null;
  const byId = new Map<string, Layout>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.i !== 'string' || !TILE_IDS.includes(o.i as TileId)) return null;
    if (![o.x, o.y, o.w, o.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    byId.set(o.i, {
      i: o.i,
      x: o.x as number,
      y: o.y as number,
      w: o.w as number,
      h: o.h as number,
      minW: typeof o.minW === 'number' ? o.minW : 2,
      minH: typeof o.minH === 'number' ? o.minH : 2,
    });
  }
  if (byId.size !== TILE_IDS.length) return null;
  return TILE_IDS.map((id) => byId.get(id)!);
}

function pickItem(l: Layout): Layout {
  return { i: l.i, x: l.x, y: l.y, w: l.w, h: l.h, minW: l.minW, minH: l.minH };
}

function cloneLayout(layout: Layout[]): Layout[] {
  return layout.map((l) => ({ ...l }));
}
