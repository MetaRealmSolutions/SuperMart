import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, ErrorBox, Field, T, colors } from '@/ui';

const DEMO = [
  ['owner', '1111'],
  ['manager', '3333'],
  ['cashier', '7777'],
  ['warehouse', '5555'],
  ['purchaser', '4444'],
  ['accountant', '8888'],
];

export default function Login() {
  const { user, signIn, ready } = useSession();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (ready && user) return <Redirect href="/dashboard" />;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim().toLowerCase(), pin);
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.sidebar, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: 420, maxWidth: '100%' }}>
        <T size="xl" bold>
          SuperMart
        </T>
        <View style={{ marginVertical: 6 }}>
          <Badge text="DEMO / MOCK PAYMENTS — no real money or card data" tone="demo" />
        </View>
        <T muted style={{ marginBottom: 16 }}>
          Sign in with your username and PIN.
        </T>
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoFocus onSubmitEditing={submit} />
        <Field label="PIN" value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" onSubmitEditing={submit} />
        <ErrorBox error={error} />
        <Button title="Sign in" onPress={submit} loading={busy} disabled={!username || !pin} style={{ marginTop: 12 }} />
        <T size="sm" muted style={{ marginTop: 16 }}>
          Demo accounts (username / PIN):
        </T>
        <T size="sm" muted>
          {DEMO.map(([u, p]) => `${u} / ${p}`).join('   ·   ')}
        </T>
      </Card>
    </View>
  );
}
