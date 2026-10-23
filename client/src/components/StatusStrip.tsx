// Separate signals for local capture and server saving; a viewer sees server freshness only.

import type { StatusResponse } from '../../../shared/api';
import type { CaptureSnapshot } from '../capture/controller';
import { ageText } from '../lib/format';

type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'demo';

function Pill({ tone, label, detail }: { tone: Tone; label: string; detail?: string }) {
  return (
    <span className={`pill pill-${tone}`}>
      <i />
      <b>{label}</b>
      {detail && <span>{detail}</span>}
    </span>
  );
}

export function StatusStrip({ cap, server, now }: { cap: CaptureSnapshot; server: StatusResponse | null; now: number }) {
  if (cap.mode === 'demo') {
    return (
      <div className="status-strip">
        <Pill tone="demo" label="Demo — simulated data" detail="nothing is saved" />
        <Pill tone={cap.phase === 'receiving' ? 'ok' : 'warn'} label={cap.phase === 'receiving' ? 'Receiving' : cap.phase === 'stale' ? 'Stale' : 'Waiting'} detail={cap.lastValidAt ? ageText(now - cap.lastValidAt) : undefined} />
      </div>
    );
  }

  const pills: JSX.Element[] = [];
  if (cap.mode === 'real') {
    const p = cap.phase;
    if (p === 'waiting') pills.push(<Pill key="cap" tone="warn" label="Connected — waiting for a valid reading" />);
    else if (p === 'receiving') pills.push(<Pill key="cap" tone="ok" label="Receiving" detail={cap.lastValidAt ? `last reading ${ageText(now - cap.lastValidAt)}` : undefined} />);
    else if (p === 'stale') pills.push(<Pill key="cap" tone="bad" label="Stale" detail={cap.lastValidAt ? `no valid reading since ${ageText(now - cap.lastValidAt)}` : undefined} />);
    else pills.push(<Pill key="cap" tone="warn" label="Connecting…" />);

    const u = cap.upload;
    if (cap.recordingPaused) pills.push(<Pill key="save" tone="bad" label="Recording paused" detail="see banner" />);
    else if (u.state === 'paused') pills.push(<Pill key="save" tone="bad" label="Recording paused" detail="sign in to resume" />);
    else if (u.state === 'offline') pills.push(<Pill key="save" tone="warn" label="Offline — queued" detail={`${u.pending} waiting`} />);
    else if (u.pending > 0) pills.push(<Pill key="save" tone="warn" label="Saving" detail={`${u.pending} in queue`} />);
    else if (u.state === 'saved') pills.push(<Pill key="save" tone="ok" label="Saved" detail={u.lastSavedAt ? ageText(now - u.lastSavedAt) : undefined} />);
    else pills.push(<Pill key="save" tone="idle" label="Saving" detail="starting" />);
  } else {
    pills.push(<Pill key="cap" tone="idle" label="Disconnected" detail="this browser is not reading the instrument" />);
    if (cap.upload.pending > 0) pills.push(<Pill key="save" tone="warn" label={cap.upload.state === 'offline' ? 'Offline — queued' : 'Saving'} detail={`${cap.upload.pending} from an earlier session`} />);
  }

  if (server) {
    const age = server.freshness.ageMs;
    const tone: Tone = age === null ? 'idle' : server.freshness.stale ? 'bad' : 'ok';
    pills.push(
      <Pill key="srv" tone={tone} label="Station on server" detail={age === null ? 'no saved readings yet' : `last saved reading ${ageText(age)}${server.capture.active ? '' : ' · capture computer offline'}`} />,
    );
  }
  return <div className="status-strip">{pills}</div>;
}
