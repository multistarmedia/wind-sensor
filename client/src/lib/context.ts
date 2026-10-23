import { createContext, useContext } from 'react';
import type { SettingsResponse } from '../../../shared/api';

export interface AppCtx {
  settings: SettingsResponse;
  setSettings: (s: SettingsResponse) => void;
  navigate: (route: Route) => void;
}

export type Route = 'dashboard' | 'history' | 'log' | 'connection' | 'settings' | 'guide';

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppContext missing');
  return c;
}
