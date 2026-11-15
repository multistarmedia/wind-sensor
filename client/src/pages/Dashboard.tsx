import { Banner, Button, ButtonGroup } from '@shopify/polaris';
import { capture } from '../capture/controller';
import { ConnectButton } from '../components/ConnectButton';
import { ConsoleGrid } from '../components/ConsoleGrid';
import { HumidityTile } from '../components/modules/HumidityTile';
import { PressureTile } from '../components/modules/PressureTile';
import { RainTile } from '../components/modules/RainTile';
import { SolarTile } from '../components/modules/SolarTile';
import { SupplyTile } from '../components/modules/SupplyTile';
import { TemperatureTile } from '../components/modules/TemperatureTile';
import { WindTile } from '../components/modules/WindTile';
import { useApp } from '../lib/context';
import { useCapture } from '../lib/hooks';
import { useStationNow } from '../lib/station';

export function Dashboard() {
  const { navigate } = useApp();
  const cap = useCapture();
  const s = useStationNow();

  return (
    <div className="dashboard">
      {cap.error && cap.mode === 'off' && (
        <Banner tone="critical" title="Instrument connection" onDismiss={() => capture.clearError()} action={{ content: 'Connection help', onAction: () => navigate('connection') }}>
          <p>{cap.error.message}</p>
        </Banner>
      )}
      {cap.recordingPaused && <Banner tone="critical" title="Recording paused"><p>{cap.recordingPaused}</p></Banner>}
      {cap.upload.state === 'paused' && cap.upload.message && <Banner tone="warning" title="Not saving"><p>{cap.upload.message}</p></Banner>}

      <div className="dash-actions">
        <div className="dash-actions-lead">
          <ConnectButton />
          <h1 className="dash-banner-title">AIO 3 Weather Station</h1>
        </div>
        <ButtonGroup>
          <Button onClick={() => navigate('history')}>History</Button>
          <Button onClick={() => navigate('log')}>Log &amp; export</Button>
        </ButtonGroup>
      </div>

      <ConsoleGrid
        tiles={{
          wind: <WindTile />,
          pressure: <PressureTile />,
          temperature: <TemperatureTile />,
          humidity: <HumidityTile />,
          supply: <SupplyTile />,
          rain: <RainTile />,
          solar: <SolarTile />,
        }}
      />

      <p className="fine center">
        Times shown in {s.tz}. {s.demo ? 'Demo readings are simulated and never saved.' : 'Readings are timestamped by the capture browser when received.'}
      </p>
    </div>
  );
}
