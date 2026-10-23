import { Banner, BlockStack, Button, Card, FormLayout, InlineStack, Select, Text, TextField } from '@shopify/polaris';
import { useMemo, useState } from 'react';
import { SUGGESTED_PROFILE, sameInterpretation, type ProfileSettings } from '../../../shared/profile';
import { PRESSURE_DISPLAY_UNITS, RAIN_DISPLAY_UNITS, TEMP_DISPLAY_UNITS, WIND_DISPLAY_UNITS, type DisplayUnits } from '../../../shared/units';
import { ProfileForm } from '../components/ProfileForm';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/context';
import { useCapture } from '../lib/hooks';
import { timeZoneOptions } from './Setup';

export function Settings({ onSignOut }: { onSignOut: () => void }) {
  const { settings, setSettings } = useApp();
  const cap = useCapture();
  const s = settings.station;
  const [name, setName] = useState(s.name);
  const [tz, setTz] = useState(s.timeZone);
  const [retention, setRetention] = useState(String(s.retentionDays));
  const [units, setUnits] = useState<DisplayUnits>(s.displayUnits);
  const [profile, setProfile] = useState<ProfileSettings>(settings.profile ?? SUGGESTED_PROFILE);
  const [msg, setMsg] = useState<{ tone: 'success' | 'critical'; text: string } | null>(null);
  const zones = useMemo(timeZoneOptions, []);
  const capturing = cap.mode === 'real';
  const profileChanged = !settings.profile || !sameInterpretation(settings.profile, profile);

  const save = async (withProfile: boolean) => {
    setMsg(null);
    try {
      const next = await api.updateSettings({
        station: { name, timeZone: tz, retentionDays: Number(retention), displayUnits: units },
        ...(withProfile ? { profile } : {}),
      });
      setSettings(next);
      setProfile(next.profile ?? profile);
      setMsg({ tone: 'success', text: withProfile && profileChanged ? `Saved. New input profile version ${next.profile?.version} applies to the next capture session.` : 'Saved.' });
    } catch (e) {
      setMsg({ tone: 'critical', text: e instanceof ApiError ? e.message : 'Saving failed' });
    }
  };

  return (
    <div className="page-narrow">
      <BlockStack gap="400">
        <Text as="h1" variant="headingXl">Settings</Text>
        {msg && <Banner tone={msg.tone} onDismiss={() => setMsg(null)}><p>{msg.text}</p></Banner>}
        <Card>
          <FormLayout>
            <Text as="h2" variant="headingMd">Station</Text>
            <TextField label="Name" value={name} onChange={setName} autoComplete="off" maxLength={80} />
            <Select label="Time zone" options={zones} value={tz} onChange={setTz} />
            <TextField label="Keep readings for (days)" type="number" min={1} max={3650} value={retention} onChange={setRetention} autoComplete="off"
              helpText="Older readings are deleted automatically. About 85,000 readings per day at 1 per second." />
            <Text as="h2" variant="headingMd">Display units</Text>
            <Text as="p" variant="bodySm" tone="subdued">Display only. Stored readings and CSV files always use metric units.</Text>
            <FormLayout.Group condensed>
              <Select label="Wind" options={WIND_DISPLAY_UNITS.map((u) => ({ label: u, value: u }))} value={units.wind} onChange={(v) => setUnits({ ...units, wind: v as DisplayUnits['wind'] })} />
              <Select label="Temperature" options={TEMP_DISPLAY_UNITS.map((u) => ({ label: `°${u}`, value: u }))} value={units.temp} onChange={(v) => setUnits({ ...units, temp: v as DisplayUnits['temp'] })} />
              <Select label="Pressure" options={PRESSURE_DISPLAY_UNITS.map((u) => ({ label: u, value: u }))} value={units.pressure} onChange={(v) => setUnits({ ...units, pressure: v as DisplayUnits['pressure'] })} />
              <Select label="Rain" options={RAIN_DISPLAY_UNITS.map((u) => ({ label: u, value: u }))} value={units.rain} onChange={(v) => setUnits({ ...units, rain: v as DisplayUnits['rain'] })} />
            </FormLayout.Group>
            <InlineStack align="end"><Button variant="primary" onClick={() => void save(false)}>Save station settings</Button></InlineStack>
          </FormLayout>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Instrument output profile {settings.profile && <small className="muted">version {settings.profile.version}</small>}</Text>
            {capturing && <Banner tone="info"><p>Disconnect the instrument to change how its lines are read. The active capture session keeps the profile it started with.</p></Banner>}
            <Text as="p" variant="bodySm" tone="subdued">Changing these creates a new profile version. Readings already saved or still queued keep the profile they were recorded with.</Text>
            <ProfileForm value={profile} onChange={setProfile} disabled={capturing} />
            <InlineStack align="end">
              <Button variant="primary" disabled={capturing || !profile.unitsConfirmed || !profileChanged} onClick={() => void save(true)}>Save instrument profile</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <Text as="p">Signing out stops capture in this tab. Queued readings stay in this browser and upload after the next sign-in.</Text>
            <Button tone="critical" onClick={onSignOut}>Sign out</Button>
          </InlineStack>
        </Card>
      </BlockStack>
    </div>
  );
}
