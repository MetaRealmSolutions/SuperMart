import React, { useState } from 'react';
import { View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { rpc } from '@/lib/api';
import { daysAgo, localDate, money, qtyText } from '@/lib/format';
import { Card, DataTable, ErrorBox, Field, Loading, Screen, T, Button, downloadCsv, useQuery, type Column } from '@/ui';

export default function Reports() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(localDate());
  const summary = useQuery(() => rpc<any>('reports.salesSummary', { from, to }), [from, to]);
  const top = useQuery(() => rpc<any[]>('reports.topProducts', { from, to, limit: 20 }), [from, to]);
  const pay = useQuery(() => rpc<any>('reports.paymentSummary', { from, to }), [from, to]);

  const dayCols: Column<any>[] = [
    { key: 'date', title: 'Date', width: 120 },
    { key: 'bills', title: 'Bills', width: 80, align: 'right' },
    { key: 'gross_minor', title: 'Gross', align: 'right', render: (r) => <T size="sm">{money(r.gross_minor)}</T> },
    { key: 'discount_minor', title: 'Discounts', align: 'right', render: (r) => <T size="sm">{money(r.discount_minor)}</T> },
    { key: 'tax_minor', title: 'Tax included', align: 'right', render: (r) => <T size="sm">{money(r.tax_minor)}</T> },
    {
      key: 'net_minor',
      title: 'Net sales',
      align: 'right',
      render: (r) => (
        <T size="sm" bold>
          {money(r.net_minor)}
        </T>
      ),
    },
  ];
  const topCols: Column<any>[] = [
    { key: 'sku', title: 'SKU', width: 110 },
    { key: 'name', title: 'Product', flex: 2 },
    { key: 'qty_milli', title: 'Qty sold', align: 'right', render: (r) => <T size="sm">{qtyText(r.qty_milli)}</T> },
    {
      key: 'revenue_minor',
      title: 'Revenue',
      align: 'right',
      render: (r) => (
        <T size="sm" bold>
          {money(r.revenue_minor)}
        </T>
      ),
    },
  ];
  const payCols: Column<any>[] = [
    { key: 'method', title: 'Method', width: 100 },
    { key: 'kind', title: 'Kind', width: 100 },
    { key: 'status', title: 'Status', width: 110 },
    { key: 'count', title: 'Count', width: 80, align: 'right' },
    { key: 'amount_minor', title: 'Amount', align: 'right', render: (r) => <T size="sm">{money(r.amount_minor)}</T> },
  ];

  return (
    <Guard perm="reports.basic">
      <Screen title="Sales Reports" subtitle="Net sales = completed bills (tax-inclusive). This is revenue, not profit.">
        <Card>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Field label="From" value={from} onChangeText={setFrom} />
            <Field label="To" value={to} onChangeText={setTo} />
          </View>
        </Card>
        <ErrorBox error={summary.error || top.error || pay.error} />
        <Card
          title="Daily sales"
          right={
            <Button
              title="Export CSV"
              small
              kind="secondary"
              onPress={() =>
                downloadCsv(
                  `daily-sales-${from}_${to}.csv`,
                  ['date', 'bills', 'gross', 'discount', 'tax_included', 'net'],
                  (summary.data?.days ?? []).map((d: any) => [
                    d.date,
                    d.bills,
                    d.gross_minor / 100,
                    d.discount_minor / 100,
                    d.tax_minor / 100,
                    d.net_minor / 100,
                  ]),
                )
              }
            />
          }
        >
          {summary.loading ? (
            <Loading />
          ) : (
            <>
              <T bold>
                Totals: {summary.data?.totals.bills} bills · Net {money(summary.data?.totals.net_minor)} · Discounts{' '}
                {money(summary.data?.totals.discount_minor)} · Tax incl. {money(summary.data?.totals.tax_minor)}
              </T>
              <DataTable rows={summary.data?.days ?? []} columns={dayCols} rowKey={(r) => r.date} empty="No completed sales in range" />
            </>
          )}
        </Card>
        <Card title="Top products by revenue">
          {top.loading ? <Loading /> : <DataTable rows={top.data ?? []} columns={topCols} rowKey={(r) => r.product_id} />}
        </Card>
        <Card title="Payments (DEMO/MOCK)">
          {pay.loading ? (
            <Loading />
          ) : (
            <DataTable rows={pay.data?.rows ?? []} columns={payCols} rowKey={(r) => `${r.method}${r.kind}${r.status}`} />
          )}
          <T size="sm" muted style={{ marginTop: 8 }}>
            Payment attempts (incl. declined / failed, which never became sales):{' '}
            {(pay.data?.attempts ?? []).map((a: any) => `${a.status}: ${a.count}`).join(' · ') || 'none'}
          </T>
        </Card>
      </Screen>
    </Guard>
  );
}
