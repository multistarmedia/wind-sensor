// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsResponse } from '../shared/api';
import { AppContext, useApp, type AppCtx } from '../client/src/lib/context';

function makeCtx(): AppCtx {
  return {
    settings: { station: {}, profile: null } as unknown as SettingsResponse,
    setSettings: vi.fn(),
    navigate: vi.fn(),
  };
}

function providerWith(value: AppCtx | null) {
  return ({ children }: { children: ReactNode }) => (
    <AppContext.Provider value={value}>{children}</AppContext.Provider>
  );
}

/** Silence React's dev-mode error replay (console.error + jsdom uncaught-error report) while fn runs. */
function quietly(fn: () => void) {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const swallow = (e: ErrorEvent) => e.preventDefault();
  window.addEventListener('error', swallow);
  try {
    fn();
  } finally {
    window.removeEventListener('error', swallow);
    spy.mockRestore();
  }
}

describe('useApp', () => {
  it('throws when rendered outside an AppContext provider', () => {
    quietly(() => {
      expect(() => renderHook(() => useApp())).toThrow('AppContext missing');
    });
  });

  it('throws when the provider value is null', () => {
    quietly(() => {
      expect(() => renderHook(() => useApp(), { wrapper: providerWith(null) })).toThrow(
        'AppContext missing',
      );
    });
  });

  it('returns the provided context value unchanged', () => {
    const ctx = makeCtx();
    const { result } = renderHook(() => useApp(), { wrapper: providerWith(ctx) });
    expect(result.current).toBe(ctx);
    expect(result.current.settings).toBe(ctx.settings);
  });

  it('exposes callbacks that reach the provider', () => {
    const ctx = makeCtx();
    const { result } = renderHook(() => useApp(), { wrapper: providerWith(ctx) });

    result.current.navigate('history');
    expect(ctx.navigate).toHaveBeenCalledWith('history');

    const next = { station: {}, profile: null } as unknown as SettingsResponse;
    result.current.setSettings(next);
    expect(ctx.setSettings).toHaveBeenCalledWith(next);
  });
});
