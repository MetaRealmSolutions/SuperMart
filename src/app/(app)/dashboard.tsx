import React from 'react';
import { View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { useSession } from '@/lib/session';
import { Badge, Card, Screen, T } from '@/ui';

export default function Dashboard() {
  const { user, modules } = useSession();
  return (
    <Guard perm="catalog.view">
      <Screen title={`Welcome, ${user?.name}`} subtitle={`Signed in as ${user?.role.replace('_', ' ')}`}>
        <Card title="Enabled modules">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {modules.map((m) => (
              <Badge key={m} text={m} tone="good" />
            ))}
          </View>
        </Card>
        <T muted>Payments in this system are simulated (DEMO/MOCK).</T>
      </Screen>
    </Guard>
  );
}
