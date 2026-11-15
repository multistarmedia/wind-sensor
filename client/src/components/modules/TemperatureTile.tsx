import { useCallback, useState } from 'react';
import { formatStationTime } from '../../../../shared/time';
import { cToDisplay, type DisplayUnits } from '../../../../shared/units';
import { TEMP_WINDOW_ROWS, type TempPoint, type TempWindowId, useTempProfile } from '../../lib/tempSeries';
import { TemperatureChart } from './TemperatureChart';
import { TileShell } from './TileShell';

export function TemperatureTile() {
  const [windowId, setWindowId] = useState<TempWindowId>('24h');
  const [showBadges, setShowBadges] = useState(true);
  const [showDew, setShowDew] = useState(false);
  const [showFeels, setShowFeels] = useState(false);
  const [cursor, setCursor] = useState<TempPoint | null>(null);
  const s = useTempProfile(windowId);
  const unitIsF = s.units.temp === 'F';
  const degree = unitIsF ? '°F' : '°C';
  const liveTemp = s.latestM?.airTempC == null ? null : cToDisplay(s.latestM.airTempC, s.units.temp);
  const shown = cursor?.temp ?? liveTemp;
  const hi = s.extremes.hi?.temp ?? null;
  const lo = s.extremes.lo?.temp ?? null;
  const clock = formatStationTime(cursor?.t ?? s.latestAt ?? s.now, s.tz, { hour: 'numeric', minute: '2-digit' });

  const onCursor = useCallback((p: TempPoint | null) => {
    setCursor((prev) => {
      if (prev?.t === p?.t && prev?.temp === p?.temp) return prev;
      return p;
    });
  }, []);

  return (
    <TileShell
      className="temp-tile-panel"
      title="AMBIENT TEMPERATURE"
      stale={s.stale}
      control={(
        <div className="temp-live-stack">
          <span className={`temp-live-badge${s.stale ? ' is-stale' : ''}`}>
            <i />
            {s.stale ? 'Stale' : 'Live'}
          </span>
          <time className="temp-live-clock" dateTime={new Date(cursor?.t ?? s.latestAt ?? s.now).toISOString()}>
            {clock}
          </time>
        </div>
      )}
    >
      <div className="temp-tile">
        <header className="temp-header">
          <div className="temp-header-left">
            <div className="temp-readout" aria-label="Ambient temperature">
              <b>{shown == null ? '—' : Math.round(shown)}</b>
              <span>{degree}</span>
            </div>
            <div className="temp-subtitle-row">
              <div className="seg" role="group" aria-label="Temperature units">
                {(['F', 'C'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={s.units.temp === u ? 'on' : ''}
                    onClick={() => void s.setUnits({ temp: u as DisplayUnits['temp'] })}
                  >
                    °{u}
                  </button>
                ))}
              </div>
              <p className="temp-subtitle">{s.win.subtitle}</p>
            </div>
          </div>
          <div className="temp-header-right">
            <div className="temp-hl">
              <span>H: <strong className="hi">{hi == null ? '—' : `${Math.round(hi)}°`}</strong></span>
              <span className="sep">|</span>
              <span>L: <strong className="lo">{lo == null ? '—' : `${Math.round(lo)}°`}</strong></span>
            </div>
          </div>
        </header>

        <div className="temp-chart-stage">
          <TemperatureChart
            points={s.points}
            tz={s.tz}
            unitIsF={unitIsF}
            showBadges={showBadges}
            showDew={showDew}
            showFeels={showFeels}
            onCursor={onCursor}
          />
        </div>

        <div className="temp-controls">
          <div className="temp-windows" role="group" aria-label="Time window">
            {TEMP_WINDOW_ROWS.map((row, i) => (
              <div key={i} className="temp-windows-row">
                {row.map((w) => (
                  <button key={w.id} type="button" className={w.id === windowId ? 'on' : ''} onClick={() => setWindowId(w.id)}>
                    {w.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="temp-overlays">
            <button type="button" className={`temp-chip${showBadges ? ' on-badges' : ''}`} onClick={() => setShowBadges((v) => !v)}>
              <i className="dot-g" /> Hi / Lo Badges
            </button>
            <button type="button" className={`temp-chip${showDew ? ' on-dew' : ''}`} onClick={() => setShowDew((v) => !v)} title="Calculated from air temperature and relative humidity">
              <i className="dot-b" /> Dew Point
            </button>
            <button type="button" className={`temp-chip${showFeels ? ' on-feels' : ''}`} onClick={() => setShowFeels((v) => !v)} title="Wind chill or heat index from temperature, humidity, and wind">
              <i className="dot-o" /> Feels Like
            </button>
          </div>
        </div>
      </div>
    </TileShell>
  );
}
