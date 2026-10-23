import { Button, InlineStack } from '@shopify/polaris';
import { useEffect, useState } from 'react';
import { capture } from '../capture/controller';
import { useApp } from '../lib/context';
import { useCapture } from '../lib/hooks';
import { describePort, grantedPorts, serialSupport } from '../serial/webSerial';

/** Connect / Disconnect for the real instrument. Port access is only ever requested from this click. */
export function ConnectButton({ size = 'large' }: { size?: 'slim' | 'medium' | 'large' }) {
  const { settings, navigate } = useApp();
  const cap = useCapture();
  const [granted, setGranted] = useState<SerialPort[]>([]);
  const support = serialSupport();

  useEffect(() => {
    if (cap.mode === 'off') void grantedPorts().then(setGranted);
  }, [cap.mode]);

  if (cap.mode === 'demo') {
    return <Button size={size} onClick={() => void capture.disconnect()}>Exit demo</Button>;
  }
  if (cap.mode === 'real') {
    return (
      <Button
        size={size}
        tone="critical"
        onClick={() => {
          const pending = cap.upload.pending;
          const msg = pending > 0 ? `Disconnect? ${pending} reading(s) are still uploading; they stay queued in this browser and finish uploading while this page is open.` : null;
          if (msg && !window.confirm(msg)) return;
          void capture.disconnect();
        }}
      >
        Disconnect instrument
      </Button>
    );
  }
  if (!support.ok) {
    return <Button size={size} onClick={() => navigate('connection')}>Why can’t I connect?</Button>;
  }
  if (!settings.profile) {
    return <Button size={size} variant="primary" onClick={() => navigate('settings')}>Confirm instrument settings</Button>;
  }
  const profile = settings.profile;
  return (
    <InlineStack gap="200" blockAlign="center">
      <Button size={size} variant="primary" loading={cap.phase === 'connecting'} onClick={() => void capture.connect(profile)}>
        Connect instrument
      </Button>
      {granted.length === 1 && (
        <Button size={size} onClick={() => void capture.connect(profile, granted[0])}>
          {`Reconnect ${describePort(granted[0]!).startsWith('USB') ? 'USB adapter' : 'last port'}`}
        </Button>
      )}
    </InlineStack>
  );
}
