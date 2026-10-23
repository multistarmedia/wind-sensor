import { Badge, Banner, BlockStack, Button, Card, Checkbox, DataTable, InlineStack, Text } from '@shopify/polaris';
import { useEffect, useRef, useState } from 'react';
import { FIELD_LABELS } from '../../../shared/profile';
import { formatStationTime } from '../../../shared/time';
import { capture } from '../capture/controller';
import type { QuarantinedObservation } from '../capture/queue';
import { ConnectButton } from '../components/ConnectButton';
import { api } from '../lib/api';
import { useApp } from '../lib/context';
import { ageText, DASH } from '../lib/format';
import { useCapture, useNow, usePoll } from '../lib/hooks';
import { serialSupport } from '../serial/webSerial';

export function Connection() {
  const { settings } = useApp();
  const cap = useCapture();
  const now = useNow(1000);
  const support = serialSupport();
  const diag = usePoll(cap.mode === 'demo' ? null : () => api.diagnostics(), 15_000);
  const [quarantine, setQuarantine] = useState<QuarantinedObservation[]>([]);
  const [wake, setWake] = useState(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const tz = settings.station.timeZone;

  useEffect(() => {
    void capture.queue.listQuarantine().then(setQuarantine).catch(() => undefined);
  }, [cap.upload.quarantined]);

  useEffect(() => {
    if (!wake) {
      void wakeLock.current?.release();
      wakeLock.current = null;
      return;
    }
    const acquire = async () => {
      try {
        wakeLock.current = await navigator.wakeLock.request('screen');
      } catch {
        setWake(false);
      }
    };
    void acquire();
    const onVis = () => document.visibilityState === 'visible' && wake && void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [wake]);

  const parsed = cap.lastParsed;

  return (
    <div className="page-narrow">
      <BlockStack gap="400">
        <Text as="h1" variant="headingXl">Connection &amp; diagnostics</Text>

        {!support.ok && (
          <Banner tone="warning" title="Live capture isn’t available in this browser">
            <p>{support.message}</p>
          </Banner>
        )}
        {cap.error && <Banner tone="critical" title="Connection problem" onDismiss={() => capture.clearError()}><p>{cap.error.message}</p></Banner>}
        {cap.notice && <Banner tone="info" onDismiss={() => capture.clearError()}><p>{cap.notice}</p></Banner>}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Instrument</Text>
              <PhaseBadge phase={cap.phase} mode={cap.mode} />
            </InlineStack>
            <InlineStack gap="300" blockAlign="center">
              <ConnectButton />
              {cap.mode === 'off' && <Button onClick={() => void capture.startDemo()}>Start demo (simulated)</Button>}
            </InlineStack>
            <DataTable
              columnContentTypes={['text', 'text']}
              headings={['Setting', 'Value']}
              rows={[
                ['Baud rate', '9600 (documented AIO 2 setting)'],
                ['Data bits / parity / stop bits', '8 / none / 1'],
                ['Flow control', 'None'],
                ['Port', cap.portDescription ?? DASH],
                ['Bytes received', String(cap.bytes)],
                ['Lines received', `${cap.lines} (${cap.valid} valid, ${cap.rejected} rejected)`],
                ['Last valid reading', cap.lastValidAt ? ageText(now - cap.lastValidAt) : DASH],
                ['Upload queue', `${cap.upload.pending} waiting · ${cap.upload.quarantined} rejected by server`],
              ]}
            />
            {cap.mode === 'real' && (
              <Checkbox
                label="Keep this computer’s screen awake while capturing"
                checked={wake}
                onChange={setWake}
                helpText="Helps, but is not a guarantee: capture stops if this tab closes or the computer sleeps."
              />
            )}
            <Text as="p" variant="bodySm" tone="subdued">
              Collection runs only while this tab stays open and the computer stays awake. Closing the tab, logging out or sleeping stops capture.
              Readings are queued in this browser until the server confirms them; that queue is a recovery buffer, not a backup.
            </Text>
          </BlockStack>
        </Card>

        {cap.mode === 'demo' && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center"><Text as="h2" variant="headingMd">Simulator</Text><Badge tone="attention">Demo — simulated data</Badge></InlineStack>
              <InlineStack gap="200">
                <Button onClick={() => capture.simulator?.corruptNext()}>Send a corrupted line</Button>
                <Button onClick={() => capture.simulator?.oversizeNext()}>Send an oversized line</Button>
                <Button onClick={() => capture.simulator?.pause(15_000)}>Pause 15 s</Button>
                <Button tone="critical" onClick={() => capture.simulator?.unplug()}>Simulate unplug</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Latest line</Text>
            {cap.lastRaw ? <pre className="raw-line">{cap.lastRaw}</pre> : <Text as="p" tone="subdued">Nothing received yet.</Text>}
            {parsed && (
              <DataTable
                columnContentTypes={['text', 'text', 'text']}
                headings={['Field', 'Raw text', 'Meaning']}
                rows={[
                  ...parsed.fields.map((f) => [`${f.key} · ${FIELD_LABELS[f.key]}`, f.text, interpret(f.key, parsed.measurements, cap.profile)]),
                  ['Checksum', String(parsed.checksum.reported), `matches calculated ${parsed.checksum.calculated}`],
                ]}
              />
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Raw terminal (last 200 lines)</Text>
            <div className="terminal" role="log" aria-live="off">
              {cap.terminal.length === 0 && <span className="muted">Waiting for data…</span>}
              {cap.terminal.slice().reverse().map((l) => (
                <div key={l.n} className={l.ok ? 'ok' : 'bad'}>
                  <span className="t">{formatStationTime(l.t, tz, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  <span className="x">{l.text}</span>
                  {l.reason && <span className="why">{l.reason}</span>}
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>

        {quarantine.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Rejected by the server (kept in this browser)</Text>
              <DataTable
                columnContentTypes={['text', 'text', 'text']}
                headings={['Received', 'Reason', 'Raw']}
                rows={quarantine.slice(0, 20).map((q) => [formatStationTime(Date.parse(q.observedAt), tz, { dateStyle: 'short', timeStyle: 'medium' }), `${q.code}: ${q.reason}`, q.raw])}
              />
            </BlockStack>
          </Card>
        )}

        {diag.data && (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Server diagnostics</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {diag.data.counters.observations.toLocaleString()} observations stored · database {(diag.data.counters.dbBytes / 1e6).toFixed(1)} MB · {diag.data.counters.sessions} capture sessions
              </Text>
              {diag.data.events.length === 0 ? (
                <Text as="p" tone="subdued">No rejected uploads.</Text>
              ) : (
                <DataTable
                  columnContentTypes={['text', 'text', 'text']}
                  headings={['When', 'Problem', 'Sample']}
                  rows={diag.data.events.slice(0, 30).map((e) => [formatStationTime(Date.parse(e.at), tz, { dateStyle: 'short', timeStyle: 'medium' }), `${e.code}: ${e.message}`, e.sample ?? ''])}
                />
              )}
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Which port is the instrument?</Text>
            <Text as="p">Clicking Connect opens the browser’s list of serial ports. Choose the one the AIO 2 is wired to; on Windows it shows as e.g. “Communications Port (COM2)” or “USB Serial Port (COM5)”.</Text>
            <Text as="p">Not sure which? Open <b>Device Manager → Ports (COM &amp; LPT)</b>. Unplug the adapter and watch which entry disappears. A built-in DB9 port is usually COM1 or COM2.</Text>
            <Text as="p">If the port won’t open, close any other program using it (Comet, PuTTY, HyperTerminal, a data logger): only one program can hold a COM port at a time.</Text>
            <Text as="p">Lines full of strange characters or constant checksum errors usually mean the wrong port or a baud-rate mismatch. The AIO 2 is documented at 9600 baud.</Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </div>
  );
}

function interpret(key: string, m: import('../../../shared/parser').Measurements, p: import('../../../shared/profile').ProfileSettings | null): string {
  if (!p) return '';
  switch (key) {
    case 'WS': return `${m.windSpeedMs.toFixed(2)} m/s (input ${p.windUnit})`;
    case 'WD': return `${m.windDirDeg}° from (${p.directionReference} north)`;
    case 'AT': return `${m.airTempC.toFixed(2)} °C (input °${p.tempUnit})`;
    case 'RH': return `${m.rhPct} %`;
    case 'BP': return `${m.pressureHpa.toFixed(1)} hPa station pressure (input ${p.pressureUnit})`;
    case 'RN': return m.rainMm == null ? 'ignored (no rain gauge)' : `${m.rainMm.toFixed(2)} mm raw rain field`;
    case 'SR': return m.solarWm2 == null ? 'ignored (no solar sensor)' : `${m.solarWm2} W/m²`;
    case 'BV': return `${m.supplyV} V supply`;
    case 'CMP': return `${m.compassDeg}° sensor orientation`;
    case 'CONFIG': return 'kept as-is';
    default: return '';
  }
}

function PhaseBadge({ phase, mode }: { phase: string; mode: string }) {
  if (mode === 'demo') return <Badge tone="attention">Demo — simulated data</Badge>;
  const map: Record<string, ['success' | 'warning' | 'critical' | 'info' | undefined, string]> = {
    disconnected: [undefined, 'Disconnected'],
    connecting: ['info', 'Connecting'],
    waiting: ['warning', 'Connected — waiting for a valid reading'],
    receiving: ['success', 'Receiving'],
    stale: ['critical', 'Stale'],
  };
  const [tone, label] = map[phase] ?? [undefined, phase];
  return <Badge tone={tone}>{label}</Badge>;
}
