import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { rpc } from '@/lib/api';
import { money, qtyText } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, ErrorBox, Loading, Notice, Screen, T, useQuery, colors } from '@/ui';

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card style={{ minWidth: 200, flexGrow: 1 }}>
      <T muted size="sm">
        {label}
      </T>
      <T size="xl" bold>
        {value}
      </T>
      {hint ? (
        <T muted size="sm">
          {hint}
        </T>
      ) : null}
    </Card>
  );
}

export default function Dashboard() {
  const { user, modules, can } = useSession();
  const router = useRouter();
  const d = useQuery(() => rpc<any>('dashboard.summary'), []);
  return (
    <Guard perm="catalog.view">
      <Screen title={`Welcome, ${user?.name}`} subtitle={`Signed in as ${user?.role.replace('_', ' ')}`}>
        <ErrorBox error={d.error} onRetry={d.reload} />
        {d.loading && !d.data ? <Loading /> : null}
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          {d.data?.today ? (
            <Kpi
              label={d.data.scope === 'store' ? "Today's sales (store)" : 'Your sales today'}
              value={money(d.data.today.total_minor)}
              hint={`${d.data.today.bills} bills`}
            />
          ) : null}
          {d.data?.pendingPayments !== undefined ? (
            <Kpi label="Pending payments" value={String(d.data.pendingPayments)} hint="UPI awaiting confirmation" />
          ) : null}
          {d.data?.emptyShelf !== undefined ? <Kpi label="Empty shelf items" value={String(d.data.emptyShelf)} /> : null}
        </View>
        {can('pos.sell') ? (
          <View style={{ flexDirection: 'row' }}>
            <Button title="Open cashier screen" onPress={() => router.push('/pos')} />
          </View>
        ) : null}
        {d.data?.lowStock?.length ? (
          <Card title="Low stock (store: shelf + backroom)">
            {d.data.lowStock.map((p: any) => (
              <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <T>{p.name}</T>
                <T color={colors.danger}>
                  {qtyText(p.store_milli)} / reorder at {qtyText(p.reorder_level_milli)}
                </T>
              </View>
            ))}
          </Card>
        ) : null}
        <Card title="Enabled modules">
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {modules.map((m) => (
              <Badge key={m} text={m} tone="good" />
            ))}
          </View>
        </Card>
        <Notice text="Payments in this system are simulated (DEMO/MOCK). No real card, UPI or bank is contacted." />
      </Screen>
    </Guard>
  );
}
