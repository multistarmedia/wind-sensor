import { Banner, Spinner } from '@shopify/polaris';
import { useCallback, useEffect, useState } from 'react';
import type { SettingsResponse } from '../../shared/api';
import { capture } from './capture/controller';
import { StatusStrip } from './components/StatusStrip';
import { api, onClockSkew, onUnauthenticated } from './lib/api';
import { AppContext, type Route } from './lib/context';
import { useCapture, useNow, usePoll } from './lib/hooks';
import { Connection } from './pages/Connection';
import { Dashboard } from './pages/Dashboard';
import { Guide } from './pages/Guide';
import { History } from './pages/History';
import { Log } from './pages/Log';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';

const ROUTES: { id: Route; label: string }[] = [
  { id: 'dashboard', label: 'Live' },
  { id: 'history', label: 'History' },
  { id: 'log', label: 'Log' },
  { id: 'connection', label: 'Connection' },
  { id: 'settings', label: 'Settings' },
  { id: 'guide', label: 'Guide' },
];

function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  return (ROUTES.find((r) => r.id === h)?.id ?? 'dashboard') as Route;
}

export function App() {
  const [auth, setAuth] = useState<'unknown' | 'in' | 'out'>('unknown');
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [skew, setSkew] = useState(0);
  const cap = useCapture();

  const navigate = useCallback((r: Route) => {
    window.location.hash = `/${r}`;
    setRoute(r);
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadSettings = useCallback(async () => {
    setSettings(await api.settings());
  }, []);

  useEffect(() => {
    api.session()
      .then(async (s) => {
        if (s.authenticated) {
          await loadSettings();
          setAuth('in');
        } else setAuth('out');
      })
      .catch(() => setAuth('out'));
    const off1 = onUnauthenticated(() => setAuth('out'));
    const off2 = onClockSkew(setSkew);
    return () => { off1(); off2(); };
  }, [loadSettings]);

  // Uploads run whenever signed in, so a queue left from a previous visit drains on its own.
  useEffect(() => {
    if (auth !== 'in') return;
    capture.startUploads();
    capture.uploader.resumeAfterAuth();
  }, [auth]);

  // Warn before leaving while capturing or with readings not yet on the server.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (capture.snapshot.mode === 'real' || capture.snapshot.upload.pending > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  if (auth === 'unknown') return <div className="center-screen"><Spinner accessibilityLabel="Loading" /></div>;

  if (auth === 'out') {
    const pending = cap.upload.pending;
    return (
      <Login
        pendingNote={cap.mode === 'real' || pending > 0 ? `Your session expired. ${pending} reading(s) are safe in this browser and will upload after you sign in.` : null}
        onSignedIn={() => void loadSettings().then(() => setAuth('in'))}
      />
    );
  }
  if (!settings) return <div className="center-screen"><Spinner accessibilityLabel="Loading" /></div>;

  const signOut = async () => {
    await capture.disconnect();
    await api.logout().catch(() => undefined);
    capture.stopUploads();
    setAuth('out');
  };

  return (
    <AppContext.Provider value={{ settings, setSettings, navigate }}>
      <Shell route={route} navigate={navigate} name={settings.station.name}>
        {Math.abs(skew) > 30_000 && (
          <Banner tone="warning" title="This computer’s clock looks wrong">
            <p>It differs from the server by about {Math.round(Math.abs(skew) / 1000)} s. Readings are timestamped by this browser, so set the clock to update automatically (Windows: Settings → Time &amp; language → Set time automatically).</p>
          </Banner>
        )}
        {!settings.station.setupComplete && cap.mode !== 'demo' && route !== 'guide' ? <Setup /> : <Page route={route} onSignOut={() => void signOut()} />}
      </Shell>
    </AppContext.Provider>
  );
}

function Page({ route, onSignOut }: { route: Route; onSignOut: () => void }) {
  switch (route) {
    case 'history': return <History />;
    case 'log': return <Log />;
    case 'connection': return <Connection />;
    case 'settings': return <Settings onSignOut={onSignOut} />;
    case 'guide': return <Guide />;
    default: return <Dashboard />;
  }
}

function Shell({ route, navigate, name, children }: { route: Route; navigate: (r: Route) => void; name: string; children: React.ReactNode }) {
  const cap = useCapture();
  const now = useNow(1000);
  const server = usePoll(cap.mode === 'demo' ? null : () => api.status(), 5000);
  return (
    <div className={`shell${cap.mode === 'demo' ? ' is-demo' : ''}`}>
      {cap.mode === 'demo' && <div className="demo-ribbon" role="status">Demo — simulated data · nothing here is a real reading</div>}
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="#38bdf8" strokeWidth="2" /><path d="M16 4 L20 17 L16 14 L12 17 Z" fill="#38bdf8" /></svg>
          <span>{name}</span>
        </div>
        <nav aria-label="Main">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#/${r.id}`} className={r.id === route ? 'on' : ''} onClick={(e) => { e.preventDefault(); navigate(r.id); }}>{r.label}</a>
          ))}
        </nav>
      </header>
      <StatusStrip cap={cap} server={server.data} now={now} />
      <main>{children}</main>
    </div>
  );
}
