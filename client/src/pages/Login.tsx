import { Banner, BlockStack, Button, Card, Form, FormLayout, Text, TextField } from '@shopify/polaris';
import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export function Login({ onSignedIn, pendingNote }: { onSignedIn: () => void; pendingNote?: string | null }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword('');
      onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" stroke="#38bdf8" strokeWidth="3" /><path d="M32 8 L40 34 L32 28 L24 34 Z" fill="#38bdf8" /></svg>
      </div>
      <h1 className="login-title">AIO 2 Weather Console</h1>
      <Card>
        <Form onSubmit={() => void submit()}>
          <FormLayout>
            {pendingNote && <Banner tone="warning"><p>{pendingNote}</p></Banner>}
            {error && <Banner tone="critical"><p>{error}</p></Banner>}
            <TextField label="Station password" type="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
            <BlockStack gap="200">
              <Button submit variant="primary" loading={busy} disabled={!password}>Sign in</Button>
              <Text as="p" variant="bodySm" tone="subdued">One shared owner password per station. Ask the station owner if you don’t have it.</Text>
            </BlockStack>
          </FormLayout>
        </Form>
      </Card>
    </div>
  );
}
