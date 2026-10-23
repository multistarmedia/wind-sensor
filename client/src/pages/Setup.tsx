import { Banner, BlockStack, Button, Card, FormLayout, InlineStack, Select, Text, TextField } from '@shopify/polaris';
import { useMemo, useState } from 'react';
import { SUGGESTED_PROFILE, type ProfileSettings } from '../../../shared/profile';
import { ProfileForm } from '../components/ProfileForm';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/context';
import { capture } from '../capture/controller';

export function timeZoneOptions() {
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC'];
  return zones.map((z) => ({ label: z.replace(/_/g, ' '), value: z }));
}

export function Setup() {
  const { settings, setSettings, navigate } = useApp();
  const [step, setStep] = useState(1);
  const [name, setName] = useState(settings.station.name === 'Weather station' ? '' : settings.station.name);
  const [tz, setTz] = useState(settings.station.timeZone === 'UTC' ? Intl.DateTimeFormat().resolvedOptions().timeZone : settings.station.timeZone);
  const [profile, setProfile] = useState<ProfileSettings>(settings.profile ?? SUGGESTED_PROFILE);
  const [errors, setErrors] = useState<string[]>([]);
  const zones = useMemo(timeZoneOptions, []);

  const save = async () => {
    setErrors([]);
    try {
      setSettings(await api.updateSettings({ station: { name, timeZone: tz, setupComplete: true }, profile }));
      navigate('connection');
    } catch (e) {
      setErrors(e instanceof ApiError ? e.message.split('; ') : ['Saving failed']);
    }
  };

  return (
    <div className="setup">
      <BlockStack gap="400">
        <Text as="h1" variant="headingXl">Set up your station</Text>
        <Text as="p" tone="subdued">Step {step} of 2. After this you’ll connect the instrument and see its first line next to the interpreted values.</Text>
        {errors.length > 0 && <Banner tone="critical" title="Please fix"><ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul></Banner>}
        {step === 1 && (
          <Card>
            <FormLayout>
              <TextField label="Station name" value={name} onChange={setName} autoComplete="off" placeholder="e.g. Ridge top" maxLength={80} />
              <Select label="Station time zone" options={zones} value={tz} onChange={setTz} helpText="“Today” highs, lows and peaks run midnight to midnight in this zone." />
              <InlineStack align="space-between">
                <Button onClick={() => void capture.startDemo().then(() => navigate('dashboard'))}>Try the demo first</Button>
                <Button variant="primary" disabled={!name.trim()} onClick={() => setStep(2)}>Next: instrument output</Button>
              </InlineStack>
            </FormLayout>
          </Card>
        )}
        {step === 2 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Instrument output</Text>
              <Text as="p" tone="subdued">
                These choices tell the console how to read each line. The suggestions are the AIO 2 factory defaults (metric, 1 line per second, voltage on).
                The console only listens; it never changes instrument settings.
              </Text>
              <ProfileForm value={profile} onChange={setProfile} />
              <InlineStack align="space-between">
                <Button onClick={() => setStep(1)}>Back</Button>
                <Button variant="primary" disabled={!profile.unitsConfirmed} onClick={() => void save()}>Save and connect</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </div>
  );
}
