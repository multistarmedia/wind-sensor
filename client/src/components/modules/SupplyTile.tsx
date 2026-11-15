import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatStationTime } from '../../../../shared/time';
import { fmt } from '../../lib/format';
import { useDaySeries } from '../../lib/station';

const HOUR_MS = 3600_000;
const SUPPLY_LINE = '#f59e0b';

export function SupplyTile() {
  const s = useDaySeries('supply', HOUR_MS);
  const v = s.latestM?.supplyV ?? null;
  const stale = s.stale && v != null;

  return (
    <section className={`panel tile-panel supply-tile${stale ? ' is-stale' : ''}`}>
      <div className="supply-layout">
        <div className="supply-lead">
          <h2 className="tile-drag" title="Drag to move">POWER SUPPLY</h2>
          <div className="tile-readout supply-readout">
            <div className="big"><b>{fmt(v, 1)}</b><span>V</span></div>
          </div>
        </div>
        <div className="supply-side-chart" aria-label="Power supply voltage, last hour">
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <LineChart data={s.points} margin={{ top: 2, right: 4, bottom: 2, left: 0 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
              <YAxis
                stroke="#64748b"
                fontSize={10}
                width={36}
                domain={['auto', 'auto']}
                tickFormatter={(n: number) => n.toFixed(1)}
              />
              <Tooltip
                contentStyle={{ background: '#0b1220', border: '1px solid #334155', borderRadius: 8 }}
                labelFormatter={(t) => formatStationTime(Number(t), s.tz, { timeStyle: 'short' })}
                formatter={(val: unknown) => [typeof val === 'number' ? `${val.toFixed(1)} V` : String(val), 'Supply']}
              />
              <Line dataKey="v" stroke={SUPPLY_LINE} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
