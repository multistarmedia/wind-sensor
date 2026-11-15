import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatStationTime } from '../../../../shared/time';
import { fmt } from '../../lib/format';
import { useDaySeries } from '../../lib/station';
import { TileShell } from './TileShell';

const RH_LINE = '#0B3D91';

export function HumidityTile() {
  const s = useDaySeries('humidity');
  const pct = s.latestM?.rhPct ?? null;

  return (
    <TileShell title="RELATIVE HUMIDITY" stale={s.stale}>
      <div className="tile-readout humidity-readout">
        <div className="big"><b>{fmt(pct, 0)}</b><span>% RH</span></div>
        <div className="humidity-bar" aria-hidden="true" title="Dry ← → Moist">
          <i style={{ left: `${pct == null ? 0 : Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        <div className="humidity-bar-labels" aria-hidden="true">
          <span>Dry</span>
          <span>Moist</span>
        </div>
      </div>
      <div className="tile-chart-fill" aria-label="Relative humidity timeline">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={s.points} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
            <YAxis stroke="#64748b" fontSize={10} width={28} domain={[0, 100]} tickCount={5} />
            <Tooltip
              contentStyle={{ background: '#0b1220', border: '1px solid #334155', borderRadius: 8 }}
              labelFormatter={(t) => formatStationTime(Number(t), s.tz, { timeStyle: 'short' })}
              formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(0)} %` : String(v), 'RH']}
            />
            <Line dataKey="v" stroke={RH_LINE} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </TileShell>
  );
}
