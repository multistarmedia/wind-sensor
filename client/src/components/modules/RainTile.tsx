import { Button } from '@shopify/polaris';
import { RAIN_DISPLAY_UNITS, type DisplayUnits } from '../../../../shared/units';
import { rainText } from '../../lib/format';
import { useStationNow } from '../../lib/station';
import { TileShell } from './TileShell';

export function RainTile() {
  const s = useStationNow();
  if (!s.profile?.rainGaugeInstalled) {
    return (
      <TileShell title="Rain">
        <p className="sub">Rain gauge not installed. Mark it in Settings when connected.</p>
        <Button onClick={() => s.navigate('settings')}>Open settings</Button>
      </TileShell>
    );
  }
  return (
    <TileShell
      title="Rain"
      stale={s.stale}
      control={(
        <div className="seg" role="group" aria-label="Rain units">
          {RAIN_DISPLAY_UNITS.map((u) => (
            <button key={u} type="button" className={u === s.units.rain ? 'on' : ''} disabled={s.demo} onClick={() => void s.setUnits({ rain: u as DisplayUnits['rain'] })}>{u}</button>
          ))}
        </div>
      )}
    >
      <div className="tile-readout">
        <div className="big"><b>{rainText(s.latestM?.rainMm, s.units)}</b><span>{s.units.rain}</span></div>
      </div>
    </TileShell>
  );
}
