import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { rpc } from '@/lib/api';
import { daysAgo, localDate, money, printReceipt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  Chips,
  DataTable,
  Dialog,
  ErrorBox,
  Field,
  Loading,
  Notice,
  Screen,
  T,
  statusTone,
  useQuery,
  type Column,
} from '@/ui';

export default function Sales() {
  const { can, hasModule } = useSession();
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(localDate());
  const [status, setStatus] = useState('all');
  const list = useQuery(
    () => rpc<any[]>('pos.listSales', { from, to, ...(status !== 'all' ? { status } : {}), pageSize: 500 }),
    [from, to, status],
  );
  const [detail, setDetail] = useState<{ sale: any; lines: any[]; payments: any[]; receipt: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const open = async (row: any, reprint = false) => {
    try {
      const d = await rpc('pos.getSale', { id: row.id });
      const r = await rpc('pos.receipt', { saleId: row.id, reprint });
      setDetail({ ...d, receipt: r.lines });
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const resolve = async (outcome: 'success' | 'failed') => {
    if (!detail) return;
    try {
      await rpc('pos.resolvePayment', { saleId: detail.sale.id, outcome });
      setNote(`Pending payment marked ${outcome}.`);
      await open(detail.sale);
      list.reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const cols: Column<any>[] = [
    { key: 'receipt_no', title: 'Receipt', width: 160 },
    { key: 'ts', title: 'Time (UTC)', width: 150, render: (r) => <T size="sm">{r.ts.replace('T', ' ').slice(0, 16)}</T> },
    { key: 'business_date', title: 'Business date', width: 120 },
    { key: 'cashier_name', title: 'Cashier', flex: 1 },
    { key: 'methods', title: 'Paid by', width: 120, render: (r) => <T size="sm">{r.methods ?? '—'}</T> },
    { key: 'status', title: 'Status', width: 140, render: (r) => <Badge text={r.status.replace('_', ' ')} tone={statusTone(r.status)} /> },
    { key: 'discount_minor', title: 'Discount', width: 100, align: 'right', render: (r) => <T size="sm">{money(r.discount_minor)}</T> },
    {
      key: 'total_minor',
      title: 'Total',
      width: 110,
      align: 'right',
      render: (r) => (
        <T size="sm" bold>
          {money(r.total_minor)}
        </T>
      ),
    },
  ];

  return (
    <Guard perm="sales.view">
      <Screen title="Sales History" subtitle={can('sales.view_all') ? 'All bills in the store' : 'Your bills'}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
            <Field label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} />
          </View>
          <Chips
            label="Status"
            options={[
              ['all', 'All'],
              ['completed', 'Completed'],
              ['pending_payment', 'Pending payment'],
              ['cancelled', 'Cancelled'],
              ['voided', 'Voided'],
            ].map(([value, label]) => ({ value, label }))}
            value={status}
            onChange={setStatus}
          />
        </Card>
        {note ? <Notice text={note} tone="good" /> : null}
        <ErrorBox error={list.error || err} onRetry={list.reload} />
        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={list.data ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            searchKeys={['receipt_no', 'cashier_name']}
            onRowPress={(r) => open(r)}
            empty="No sales in this range"
          />
        )}
        <Dialog visible={!!detail} title={detail ? `Bill ${detail.sale.receipt_no}` : ''} onClose={() => setDetail(null)} width={560}>
          {detail ? (
            <View>
              {detail.sale.status === 'pending_payment' ? (
                <View style={{ marginBottom: 8 }}>
                  <Notice tone="warn" text="Demo UPI payment is pending." />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <Button title="Mark paid" onPress={() => resolve('success')} />
                    <Button title="Mark failed" kind="danger" onPress={() => resolve('failed')} />
                  </View>
                </View>
              ) : null}
              <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#d9dee5', padding: 10 }}>
                {detail.receipt.map((l, i) => (
                  <T
                    key={i}
                    style={{
                      fontFamily: Platform.OS === 'web' ? 'Consolas, "Courier New", monospace' : 'monospace',
                      fontSize: 12,
                      lineHeight: 16,
                    }}
                  >
                    {l}
                  </T>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                {hasModule('advanced_pos') ? (
                  <Button
                    title="Reprint (audited)"
                    kind="secondary"
                    onPress={async () => {
                      await open(detail.sale, true);
                      printReceipt(detail.receipt);
                    }}
                  />
                ) : null}
                <Button title="Print" onPress={() => printReceipt(detail.receipt)} />
              </View>
            </View>
          ) : null}
        </Dialog>
      </Screen>
    </Guard>
  );
}
