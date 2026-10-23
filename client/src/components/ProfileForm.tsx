// Instrument output profile: how records are interpreted. Every option maps to an AIO 2 terminal setting.

import { Banner, BlockStack, Box, Checkbox, FormLayout, Select, Text } from '@shopify/polaris';
import { expectedFields, type ProfileSettings } from '../../../shared/profile';

interface Props {
  value: ProfileSettings;
  onChange: (v: ProfileSettings) => void;
  disabled?: boolean;
}

export function ProfileForm({ value: v, onChange, disabled }: Props) {
  const set = <K extends keyof ProfileSettings>(k: K, x: ProfileSettings[K]) => {
    const next = { ...v, [k]: x, unitsConfirmed: k === 'unitsConfirmed' ? (x as boolean) : false };
    if (k === 'format' && x === 'legacy') Object.assign(next, { includesVoltage: false, includesCompass: false, rainGaugeInstalled: false, solarInstalled: false });
    onChange(next);
  };
  const legacy = v.format === 'legacy';
  return (
    <FormLayout>
      <Select
        label="Output record format (RT command)"
        disabled={disabled}
        options={[
          { label: 'Standard Met record (RT1, factory default)', value: 'standard' },
          { label: 'Legacy AIO 102780 emulation (RT2)', value: 'legacy' },
        ]}
        value={v.format}
        onChange={(x) => set('format', x as ProfileSettings['format'])}
      />
      {!legacy && (
        <FormLayout.Group>
          <Checkbox label="Supply voltage field included (BV1)" disabled={disabled} checked={v.includesVoltage} onChange={(x) => set('includesVoltage', x)} />
          <Checkbox label="Alignment compass field included (CV1)" disabled={disabled} checked={v.includesCompass} onChange={(x) => set('includesCompass', x)} />
        </FormLayout.Group>
      )}
      <FormLayout.Group condensed>
        <Select label="Wind speed (SU)" disabled={disabled} options={[{ label: 'm/s (SU0)', value: 'm/s' }, { label: 'mph (SU1)', value: 'mph' }]} value={v.windUnit} onChange={(x) => set('windUnit', x as ProfileSettings['windUnit'])} />
        <Select label="Temperature (TU)" disabled={disabled} options={[{ label: '°C (TU1)', value: 'C' }, { label: '°F (TU0)', value: 'F' }]} value={v.tempUnit} onChange={(x) => set('tempUnit', x as ProfileSettings['tempUnit'])} />
        <Select label="Pressure (PU)" disabled={disabled} options={[{ label: 'hPa / mbar (PU0)', value: 'hPa' }, { label: 'inHg (PU1)', value: 'inHg' }, { label: 'mmHg (PU2)', value: 'mmHg' }]} value={v.pressureUnit} onChange={(x) => set('pressureUnit', x as ProfileSettings['pressureUnit'])} />
        {!legacy && <Select label="Rain (RU)" disabled={disabled} options={[{ label: 'mm (RU0)', value: 'mm' }, { label: 'inches (RU1)', value: 'in' }]} value={v.rainUnit} onChange={(x) => set('rainUnit', x as ProfileSettings['rainUnit'])} />}
      </FormLayout.Group>
      {!legacy && (
        <FormLayout.Group>
          <Checkbox label="External rain gauge installed" disabled={disabled} checked={v.rainGaugeInstalled} onChange={(x) => set('rainGaugeInstalled', x)} helpText="If not, the rain field is ignored instead of shown as zero." />
          <Checkbox label="External solar sensor installed" disabled={disabled} checked={v.solarInstalled} onChange={(x) => set('solarInstalled', x)} helpText="If not, the solar field is ignored." />
        </FormLayout.Group>
      )}
      <FormLayout.Group>
        <Select
          label="Wind direction reference (MD command)"
          disabled={disabled}
          options={[
            { label: 'Not confirmed', value: 'unconfirmed' },
            { label: 'Magnetic north (declination 0, factory default)', value: 'magnetic' },
            { label: 'True north (declination set on the instrument)', value: 'true' },
          ]}
          value={v.directionReference}
          onChange={(x) => set('directionReference', x as ProfileSettings['directionReference'])}
        />
        <Select
          label="Output interval (OI command)"
          disabled={disabled}
          options={[1, 2, 5, 15, 30, 60].map((s) => ({ label: `Every ${s} s${s === 1 ? ' (default)' : ''}`, value: String(s) }))}
          value={String(v.intervalSeconds)}
          onChange={(x) => set('intervalSeconds', Number(x) as ProfileSettings['intervalSeconds'])}
        />
      </FormLayout.Group>
      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">Expected field order for these settings:</Text>
          <Text as="p" variant="bodyMd" fontWeight="semibold"><code>{expectedFields(v).join(',')},*CHECKSUM</code></Text>
        </BlockStack>
      </Box>
      <Checkbox
        label="I checked the instrument’s actual output settings and they match the choices above"
        disabled={disabled}
        checked={v.unitsConfirmed}
        onChange={(x) => set('unitsConfirmed', x)}
        helpText="Readings are only recorded once confirmed. The configuration marker in each line (e.g. U0, M0) alone does not establish the units."
      />
      {!v.unitsConfirmed && (
        <Banner tone="info">
          <p>Not sure? Check with Met One’s Comet software or a terminal (three Enter presses within 2 s enters terminal mode; type SU, TU, PU, RU, BV, CV, RT to view each setting, then Q). This app never sends commands to the instrument.</p>
        </Banner>
      )}
    </FormLayout>
  );
}
