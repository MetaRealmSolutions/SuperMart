import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { rpc } from '@/lib/api';
import { localDate, minorToText, money, qtyText, toMinor } from '@/lib/format';
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
import { Select } from '@/ui/Select';

const IN = [
  ['receipt', 'Receipt (purchase)'],
  ['opening', 'Opening stock'],
  ['found', 'Found'],
  ['correction_in', 'Correction (+)'],
] as const;
const OUT = [
  ['damage', 'Damaged'],
  ['expiry', 'Expired'],
  ['theft_loss', 'Theft / loss'],
  ['correction_out', 'Correction (−)'],
  ['sample', 'Sample / internal use'],
] as const;

export default function Stock() {
  const { can, hasModule } = useSession();
  const [tab, setTab] = useState<'summary' | 'levels' | 'ledger'>('summary');
  const summary = useQuery(() => rpc<any[]>('stock.summary'), []);
  const levels = useQuery(() => (tab === 'levels' ? rpc<any[]>('stock.levels', { pageSize: 500 }) : Promise.resolve([])), [tab]);
  const ledger = useQuery(() => (tab === 'ledger' ? rpc<any[]>('stock.ledger', { pageSize: 300 }) : Promise.resolve([])), [tab]);
  const locations = useQuery(() => rpc<any[]>('stock.locations'), []);
  const [dlg, setDlg] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    productId: null as number | null,
    locationId: null as number | null,
    dir: 'in',
    reason: 'receipt',
    qty: '',
    cost: '',
    note: '',
    batchNo: '',
    expiry: '',
    batchId: null as number | null,
  });
  const [prodInfo, setProdInfo] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const batchOn = hasModule('inventory_controls') || hasModule('warehouse');

  useEffect(() => {
    setProdInfo(null);
    if (!f.productId) return;
    rpc('catalog.getProduct', { id: f.productId })
      .then(setProdInfo)
      .catch(() => {});
  }, [f.productId]);
  useEffect(() => {
    if (!f.productId || !f.locationId || f.dir === 'in') return setRows([]);
    rpc<any[]>('stock.levels', { productId: f.productId, locationId: f.locationId })
      .then((r) => setRows(r.filter((x) => x.status === 'sellable')))
      .catch(() => setRows([]));
  }, [f.productId, f.locationId, f.dir]);

  const open = (row?: any) => {
    setError(null);
    const shelf = (locations.data ?? []).find((l) => l.kind === 'shelf');
    setF({
      productId: row?.id ?? null,
      locationId: shelf?.id ?? null,
      dir: 'in',
      reason: 'receipt',
      qty: '',
      cost: '',
      note: '',
      batchNo: '',
      expiry: localDate(new Date(Date.now() + 30 * 86400000)),
      batchId: null,
    });
    setDlg(true);
  };

  const submit = async () => {
    const q = Number(f.qty);
    if (!f.productId || !f.locationId || !(q > 0)) return setError('Choose product, location and a positive quantity.');
    let cost = 0;
    if (f.dir === 'in' && f.reason === 'receipt' && f.cost) {
      const c = toMinor(f.cost);
      if (c === null) return setError('Enter a valid unit cost.');
      cost = c;
    }
    try {
      const r = await rpc('stock.adjust', {
        productId: f.productId,
        locationId: f.locationId,
        deltaMilli: (f.dir === 'in' ? 1 : -1) * Math.round(q * 1000),
        reason: f.reason,
        note: f.note,
        unitCostMinor: cost,
        batchId: f.dir === 'out' ? (f.batchId ?? 0) : 0,
        ...(f.dir === 'in' && prodInfo?.track_batch && batchOn ? { batchNo: f.batchNo, expiryDate: f.expiry } : {}),
      });
      setMsg(`Stock updated (${r.ref}).`);
      setDlg(false);
      summary.reload();
      levels.reload();
      ledger.reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const sumCols: Column<any>[] = [
    { key: 'sku', title: 'SKU', width: 110 },
    { key: 'name', title: 'Product', flex: 2 },
    { key: 'shelf_milli', title: 'Shelf', width: 90, align: 'right', render: (r) => <T size="sm">{qtyText(r.shelf_milli)}</T> },
    { key: 'backroom_milli', title: 'Backroom', width: 90, align: 'right', render: (r) => <T size="sm">{qtyText(r.backroom_milli)}</T> },
    { key: 'godown_milli', title: 'Godown', width: 90, align: 'right', render: (r) => <T size="sm">{qtyText(r.godown_milli)}</T> },
    {
      key: 'held_milli',
      title: 'Quarantine / damaged',
      width: 140,
      align: 'right',
      render: (r) => <T size="sm">{qtyText(r.held_milli)}</T>,
    },
    {
      key: 'total_milli',
      title: 'Total',
      width: 90,
      align: 'right',
      render: (r) => (
        <T size="sm" bold>
          {qtyText(r.total_milli)}
        </T>
      ),
    },
    {
      key: 'value',
      title: 'Value (at cost)',
      width: 120,
      align: 'right',
      sortValue: (r) => r.total_milli * r.cost_minor,
      render: (r) => <T size="sm">{money(Math.round((r.total_milli * r.cost_minor) / 1000))}</T>,
    },
    {
      key: 'low',
      title: 'Level',
      width: 90,
      sortValue: (r) => r.shelf_milli + r.backroom_milli,
      render: (r) =>
        r.reorder_level_milli > 0 && r.shelf_milli + r.backroom_milli < r.reorder_level_milli ? (
          <Badge text="LOW" tone="warn" />
        ) : r.shelf_milli === 0 ? (
          <Badge text="EMPTY SHELF" tone="bad" />
        ) : (
          <Badge text="OK" tone="good" />
        ),
    },
  ];
  const lvlCols: Column<any>[] = [
    { key: 'sku', title: 'SKU', width: 110 },
    { key: 'name', title: 'Product', flex: 2 },
    { key: 'location', title: 'Location', flex: 1.5 },
    { key: 'batch_no', title: 'Batch', width: 120 },
    { key: 'expiry_date', title: 'Expiry', width: 110 },
    { key: 'status', title: 'Status', width: 110, render: (r) => <Badge text={r.status} tone={statusTone(r.status)} /> },
    { key: 'qty_milli', title: 'Qty', width: 90, align: 'right', render: (r) => <T size="sm">{qtyText(r.qty_milli)}</T> },
  ];
  const ledCols: Column<any>[] = [
    { key: 'ts', title: 'When (UTC)', width: 160, render: (r) => <T size="sm">{r.ts.replace('T', ' ').slice(0, 16)}</T> },
    { key: 'name', title: 'Product', flex: 2 },
    { key: 'qty_milli', title: 'Qty', width: 80, align: 'right', render: (r) => <T size="sm">{qtyText(r.qty_milli)}</T> },
    { key: 'reason', title: 'Reason', width: 130 },
    {
      key: 'from_location',
      title: 'From',
      flex: 1.2,
      render: (r) => <T size="sm">{r.from_location ? `${r.from_location} (${r.from_status})` : '—'}</T>,
    },
    {
      key: 'to_location',
      title: 'To',
      flex: 1.2,
      render: (r) => <T size="sm">{r.to_location ? `${r.to_location} (${r.to_status})` : '—'}</T>,
    },
    { key: 'ref', title: 'Ref', width: 110, render: (r) => <T size="sm">{r.ref_type ? `${r.ref_type}:${r.ref_id}` : ''}</T> },
    { key: 'actor', title: 'By', width: 130 },
  ];

  const reasons = f.dir === 'in' ? IN : OUT;
  return (
    <Guard perm="stock.view">
      <Screen
        title="Stock"
        subtitle="Where every unit is, and how it got there"
        actions={can('stock.adjust') ? <Button title="Adjust / receive stock" onPress={() => open()} /> : undefined}
      >
        {msg ? <Notice text={msg} tone="good" /> : null}
        <Chips
          options={[
            { value: 'summary', label: 'Summary' },
            { value: 'levels', label: 'By location & batch' },
            { value: 'ledger', label: 'Movement history' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <ErrorBox
          error={summary.error || levels.error || ledger.error}
          onRetry={() => {
            summary.reload();
            levels.reload();
            ledger.reload();
          }}
        />
        {tab === 'summary' ? (
          summary.loading && !summary.data ? (
            <Loading />
          ) : (
            <DataTable
              rows={summary.data ?? []}
              columns={sumCols}
              rowKey={(r) => r.id}
              searchKeys={['sku', 'name', 'category']}
              onRowPress={can('stock.adjust') ? open : undefined}
            />
          )
        ) : null}
        {tab === 'levels' ? (
          levels.loading ? (
            <Loading />
          ) : (
            <DataTable
              rows={levels.data ?? []}
              columns={lvlCols}
              rowKey={(r) => `${r.product_id}-${r.location_id}-${r.batch_id}-${r.status}`}
              searchKeys={['sku', 'name', 'location', 'batch_no']}
              pageSize={20}
            />
          )
        ) : null}
        {tab === 'ledger' ? (
          ledger.loading ? (
            <Loading />
          ) : (
            <DataTable
              rows={ledger.data ?? []}
              columns={ledCols}
              rowKey={(r) => r.id}
              searchKeys={['name', 'reason', 'actor', 'ref_id']}
              pageSize={20}
            />
          )
        ) : null}
        <Card>
          <T muted size="sm">
            Each unit lives in exactly one place (location + batch + status), so totals never double count. Every change is in the movement
            history with reason, actor and reference.
          </T>
        </Card>

        <Dialog visible={dlg} title="Adjust / receive stock" onClose={() => setDlg(false)} width={600}>
          <ErrorBox error={error} />
          <Select
            label="Product"
            options={(summary.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
            value={f.productId}
            onChange={(v) => setF({ ...f, productId: v })}
          />
          <Select
            label="Location"
            options={(locations.data ?? []).filter((l) => l.active).map((l) => ({ value: l.id, label: `${l.name} [${l.kind}]` }))}
            value={f.locationId}
            onChange={(v) => setF({ ...f, locationId: v })}
          />
          <Chips
            label="Direction"
            options={[
              { value: 'in', label: 'Increase' },
              { value: 'out', label: 'Decrease' },
            ]}
            value={f.dir}
            onChange={(v) => setF({ ...f, dir: v, reason: v === 'in' ? 'receipt' : 'damage', batchId: null })}
          />
          <Chips
            label="Reason"
            options={reasons.map(([value, label]) => ({ value, label }))}
            value={f.reason}
            onChange={(v) => setF({ ...f, reason: v })}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Field label="Quantity" value={f.qty} onChangeText={(v) => setF({ ...f, qty: v })} keyboardType="decimal-pad" />
            {f.dir === 'in' && f.reason === 'receipt' ? (
              <Field
                label="Unit cost (optional)"
                value={f.cost}
                onChangeText={(v) => setF({ ...f, cost: v })}
                keyboardType="decimal-pad"
                hint={prodInfo ? `current avg ${money(prodInfo.cost_minor)}` : undefined}
              />
            ) : null}
          </View>
          {f.dir === 'in' && prodInfo?.track_batch && batchOn ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <Field label="Batch number" value={f.batchNo} onChangeText={(v) => setF({ ...f, batchNo: v })} />
              <Field label="Expiry (YYYY-MM-DD)" value={f.expiry} onChangeText={(v) => setF({ ...f, expiry: v })} />
            </View>
          ) : null}
          {f.dir === 'out' && rows.some((r) => r.batch_id) ? (
            <Select
              label="Batch"
              options={rows.map((r) => ({
                value: r.batch_id,
                label: `${r.batch_no ?? 'no batch'} · exp ${r.expiry_date ?? '—'} · ${qtyText(r.qty_milli)}`,
              }))}
              value={f.batchId}
              onChange={(v) => setF({ ...f, batchId: v })}
            />
          ) : null}
          <Field label={f.dir === 'out' ? 'Note (required)' : 'Note'} value={f.note} onChangeText={(v) => setF({ ...f, note: v })} />
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <Button title="Cancel" kind="secondary" onPress={() => setDlg(false)} />
            <Button title="Apply" onPress={submit} />
          </View>
        </Dialog>
      </Screen>
    </Guard>
  );
}

void minorToText;
