import { Button } from '@shopify/polaris';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatStationTime } from '../../../../shared/time';
import { fmt } from '../../lib/format';
import { useDaySeries, useStationNow } from '../../lib/station';
import { TileShell } from './TileShell';

export function SolarTile() {
  const s = useStationNow();
  if (!s.profile?.solarInstalled) {
    return (
      <TileShell title="Solar">
        <p className="sub">Solar sensor not installed. Mark it in Settings when connected.</p>
        <Button onClick={() => s.navigate('settings')}>Open settings</Button>
      </TileShell>
    );
  }
  return <SolarReading />;
}

function SolarReading() {
  const s = useDaySeries('solar');
  return (
    <TileShell title="Solar" stale={s.stale}>
      <div className="tile-readout">
        <div className="big"><b>{fmt(s.latestM?.solarWm2, 0)}</b><span>W/m²</span></div>
      </div>
      <div className="tile-chart-fill">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={s.points} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} hide />
            <YAxis stroke="#64748b" fontSize={11} width={40} domain={[0, 'auto']} />
            <Tooltip
              contentStyle={{ background: '#0b1220', border: '1px solid #334155', borderRadius: 8 }}
              labelFormatter={(t) => formatStationTime(Number(t), s.tz, { timeStyle: 'short' })}
              formatter={(v: unknown) => [typeof v === 'number' ? `${v.toFixed(0)} W/m²` : String(v), 'Solar']}
            />
            <Line dataKey="v" stroke="#eab308" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </TileShell>
  );
}
