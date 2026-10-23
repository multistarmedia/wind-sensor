import { Banner, Button, Checkbox, InlineStack, Text, TextField } from '@shopify/polaris';
import { useEffect, useState } from 'react';
import type { LogRow } from '../../../shared/api';
import { formatStationTime, startOfZonedDay } from '../../../shared/time';
import { compassPoint } from '../../../shared/wind';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { DASH, fmt, pressureText, rainText, tempText, windText } from '../lib/format';
import { useCapture } from '../lib/hooks';

function dateInput(ms: number) {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function Log() {
  const { settings } = useApp();
  const cap = useCapture();
  const units = settings.station.displayUnits;
  const tz = settings.station.timeZone;
  const p = settings.profile;
  const [rows, setRows] = useState<LogRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(dateInput(Date.now()));
  const [to, setTo] = useState(dateInput(Date.now()));

  // Live tail: refresh the newest page every 2 s.
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await api.log();
        if (!alive) return;
        setRows((prev) => {
          const older = prev.filter((x) => !r.rows.some((y) => y.id === x.id) && x.observedAt < (r.rows[r.rows.length - 1]?.observedAt ?? ''));
          return [...r.rows, ...older];
        });
        setNext((n) => n ?? r.nextBefore);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [live]);

  const older = async () => {
    if (!next) return;
    const r = await api.log(next);
    setRows((prev) => [...prev, ...r.rows]);
    setNext(r.nextBefore);
  };

  // Export whole station-local days.
  const exportRange = () => {
    const f = startOfZonedDay(tz, Date.parse(`${from}T12:00:00Z`));
    const t = startOfZonedDay(tz, Date.parse(`${to}T12:00:00Z`) + 86_400_000);
    return { f, t, ok: t > f && t - f <= 31 * 86_400_000 + 3600_000 };
  };
  const er = exportRange();

  return (
    <div className="log-page">
      <div className="history-head">
        <Text as="h1" variant="headingXl">Log</Text>
        <Checkbox label="Live (newest first, updates every 2 s)" checked={live} onChange={setLive} />
      </div>
      {cap.mode === 'demo' && <Banner tone="info"><p>The log shows saved real readings only; demo readings are never saved.</p></Banner>}
      {error && <Banner tone="critical"><p>{error}</p></Banner>}

      <section className="panel export-panel">
        <h2>Download CSV</h2>
        <InlineStack gap="300" blockAlign="end" wrap>
          <TextField label="First day" type="date" value={from} onChange={setFrom} autoComplete="off" />
          <TextField label="Last day" type="date" value={to} onChange={setTo} autoComplete="off" />
          <Button variant="primary" disabled={!er.ok} url={er.ok ? api.exportUrl(new Date(er.f), new Date(er.t)) : undefined} download>Download</Button>
        </InlineStack>
        <p className="fine">
          Whole days in {tz}, up to 31 days per file. Files use canonical units (m/s, °C, hPa, mm, W/m², V) whatever the display units, with UTC timestamps,
          session and profile IDs, and the exact raw line for every reading.
        </p>
      </section>

      <div className="log-table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>Time</th><th>Wind ({units.wind})</th><th>Dir</th><th>Temp (°{units.temp})</th><th>RH %</th><th>Pressure ({units.pressure})</th>
              {p?.rainGaugeInstalled && <th>Rain field ({units.rain})</th>}
              {p?.solarInstalled && <th>Solar W/m²</th>}
              <th>Supply V</th><th className="raw">Raw line</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="muted">No saved readings yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatStationTime(Date.parse(r.observedAt), tz, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                <td className="num">{windText(r.m.windSpeedMs, units)}</td>
                <td>{`${compassPoint(r.m.windDirDeg)} ${Math.round(r.m.windDirDeg)}°`}</td>
                <td className="num">{tempText(r.m.airTempC, units)}</td>
                <td className="num">{fmt(r.m.rhPct, 0)}</td>
                <td className="num">{pressureText(r.m.pressureHpa, units)}</td>
                {p?.rainGaugeInstalled && <td className="num">{rainText(r.m.rainMm, units)}</td>}
                {p?.solarInstalled && <td className="num">{fmt(r.m.solarWm2, 0)}</td>}
                <td className="num">{r.m.supplyV == null ? DASH : r.m.supplyV.toFixed(1)}</td>
                <td className="raw"><code>{r.raw}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {next && <div className="center"><Button onClick={() => void older()}>Load older readings</Button></div>}
    </div>
  );
}
