import React, { useState } from 'react';
import { View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { rpc } from '@/lib/api';
import { minorToText, money, qtyText, toMinor } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, Chips, DataTable, Dialog, ErrorBox, Field, Loading, Notice, Screen, T, useQuery, type Column } from '@/ui';
import { Select } from '@/ui/Select';
import { UNITS } from '../../../shared/qty';

interface Form {
  id?: number;
  sku: string;
  name: string;
  categoryId: number | null;
  brandId: number | null;
  unit: string;
  isWeighed: boolean;
  price: string;
  mrp: string;
  cost: string;
  taxPct: string;
  barcodes: string;
  reorder: string;
  trackBatch: boolean;
  active: boolean;
}

const blank: Form = {
  sku: '',
  name: '',
  categoryId: null,
  brandId: null,
  unit: 'pcs',
  isWeighed: false,
  price: '',
  mrp: '',
  cost: '',
  taxPct: '0',
  barcodes: '',
  reorder: '0',
  trackBatch: false,
  active: true,
};

export default function Products() {
  const { can } = useSession();
  const list = useQuery(() => rpc<{ rows: any[]; total: number }>('catalog.listProducts', { pageSize: 500, includeInactive: true }), []);
  const cats = useQuery(() => rpc<any[]>('catalog.listCategories'), []);
  const brands = useQuery(() => rpc<any[]>('catalog.listBrands'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');

  const edit = async (row: any) => {
    const p = await rpc('catalog.getProduct', { id: row.id });
    setError(null);
    setForm({
      id: p.id,
      sku: p.sku,
      name: p.name,
      categoryId: p.category_id,
      brandId: p.brand_id,
      unit: p.unit,
      isWeighed: !!p.is_weighed,
      price: minorToText(p.price_minor),
      mrp: minorToText(p.mrp_minor),
      cost: minorToText(p.cost_minor),
      taxPct: String(p.tax_rate_bp / 100),
      barcodes: p.barcodes.join(', '),
      reorder: String(p.reorder_level_milli / 1000),
      trackBatch: !!p.track_batch,
      active: !!p.active,
    });
  };

  const save = async () => {
    if (!form) return;
    const price = toMinor(form.price);
    const mrp = form.mrp ? toMinor(form.mrp) : 0;
    const cost = form.cost ? toMinor(form.cost) : 0;
    if (price === null || mrp === null || cost === null) return setError('Enter valid amounts like 49.50');
    try {
      await rpc('catalog.saveProduct', {
        id: form.id,
        sku: form.sku.trim(),
        name: form.name.trim(),
        categoryId: form.categoryId,
        brandId: form.brandId,
        unit: form.unit,
        isWeighed: form.isWeighed,
        priceMinor: price,
        mrpMinor: mrp,
        costMinor: cost,
        taxRateBp: Math.round(Number(form.taxPct) * 100),
        trackBatch: form.trackBatch,
        reorderLevelMilli: Math.round(Number(form.reorder) * 1000),
        active: form.active,
        barcodes: form.barcodes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setSaved(`Saved ${form.name}`);
      setForm(null);
      list.reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addCategory = async () => {
    if (!newCat.trim()) return;
    try {
      const r = await rpc('catalog.saveCategory', { name: newCat.trim() });
      setNewCat('');
      cats.reload();
      if (form) setForm({ ...form, categoryId: r.id });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const columns: Column<any>[] = [
    { key: 'sku', title: 'SKU', width: 120 },
    { key: 'name', title: 'Product', flex: 2 },
    { key: 'category', title: 'Category', width: 140 },
    { key: 'price_minor', title: 'Price (incl. tax)', width: 130, align: 'right', render: (r) => <T size="sm">{money(r.price_minor)}</T> },
    { key: 'mrp_minor', title: 'MRP', width: 100, align: 'right', render: (r) => <T size="sm">{money(r.mrp_minor)}</T> },
    { key: 'tax_rate_bp', title: 'Tax', width: 70, align: 'right', render: (r) => <T size="sm">{r.tax_rate_bp / 100}%</T> },
    {
      key: 'shelf_milli',
      title: 'On shelf',
      width: 100,
      align: 'right',
      render: (r) => (
        <T size="sm" bold={r.shelf_milli === 0} color={r.shelf_milli === 0 ? '#b3261e' : undefined}>
          {qtyText(r.shelf_milli, r.unit)}
        </T>
      ),
    },
    {
      key: 'active',
      title: 'Status',
      width: 90,
      render: (r) => <Badge text={r.active ? 'Active' : 'Inactive'} tone={r.active ? 'good' : 'neutral'} />,
    },
  ];

  const set = (patch: Partial<Form>) => form && setForm({ ...form, ...patch });

  return (
    <Guard perm="catalog.view">
      <Screen
        title="Products"
        subtitle="Catalog, barcodes and prices (prices include tax)"
        actions={
          can('catalog.edit') ? (
            <Button
              title="Add product"
              onPress={() => {
                setError(null);
                setForm({ ...blank });
              }}
            />
          ) : undefined
        }
      >
        {saved ? <Notice text={saved} tone="good" /> : null}
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={list.data?.rows ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            searchKeys={['sku', 'name', 'category', 'barcodes']}
            onRowPress={can('catalog.edit') ? edit : undefined}
            empty="No products yet"
          />
        )}
        <Dialog visible={!!form} title={form?.id ? 'Edit product' : 'New product'} onClose={() => setForm(null)} width={640}>
          {form ? (
            <View>
              <ErrorBox error={error} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <Field label="SKU" value={form.sku} onChangeText={(v) => set({ sku: v })} />
                <Field label="Name" value={form.name} onChangeText={(v) => set({ name: v })} style={{ minWidth: 260 }} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <Select
                  label="Category"
                  options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  value={form.categoryId}
                  onChange={(v) => set({ categoryId: v })}
                  allowClear
                />
                <Select
                  label="Brand"
                  options={(brands.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  value={form.brandId}
                  onChange={(v) => set({ brandId: v })}
                  allowClear
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
                <Field label="Add new category" value={newCat} onChangeText={setNewCat} />
                <Button title="Add" kind="secondary" small onPress={addCategory} />
              </View>
              <Chips
                label="Unit"
                options={UNITS.map((u) => ({ value: u, label: u }))}
                value={form.unit}
                onChange={(v) => set({ unit: v })}
              />
              <Chips
                label="Sold by"
                options={[
                  { value: 'unit', label: 'Whole units' },
                  { value: 'weight', label: 'Weight / measure (fractions)' },
                ]}
                value={form.isWeighed ? 'weight' : 'unit'}
                onChange={(v) => set({ isWeighed: v === 'weight' })}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <Field
                  label="Selling price (incl. tax)"
                  value={form.price}
                  onChangeText={(v) => set({ price: v })}
                  keyboardType="decimal-pad"
                />
                <Field label="MRP" value={form.mrp} onChangeText={(v) => set({ mrp: v })} keyboardType="decimal-pad" />
                <Field
                  label="Cost"
                  value={form.cost}
                  onChangeText={(v) => set({ cost: v })}
                  keyboardType="decimal-pad"
                  hint="Updated automatically from receipts"
                />
                <Field label="Tax %" value={form.taxPct} onChangeText={(v) => set({ taxPct: v })} keyboardType="decimal-pad" />
              </View>
              {!can('price.edit') && form.id ? (
                <T size="sm" muted>
                  Price, cost and tax changes need the price.edit permission.
                </T>
              ) : null}
              <Field label="Barcodes (comma separated)" value={form.barcodes} onChangeText={(v) => set({ barcodes: v })} />
              <Field
                label="Reorder level (units)"
                value={form.reorder}
                onChangeText={(v) => set({ reorder: v })}
                keyboardType="decimal-pad"
              />
              <Chips
                label="Batch / expiry tracking"
                options={[
                  { value: 'no', label: 'Off' },
                  { value: 'yes', label: 'On (needs Warehouse or Inventory Controls module)' },
                ]}
                value={form.trackBatch ? 'yes' : 'no'}
                onChange={(v) => set({ trackBatch: v === 'yes' })}
              />
              <Chips
                label="Status"
                options={[
                  { value: 'a', label: 'Active' },
                  { value: 'i', label: 'Inactive (cannot be sold)' },
                ]}
                value={form.active ? 'a' : 'i'}
                onChange={(v) => set({ active: v === 'a' })}
              />
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <Button title="Cancel" kind="secondary" onPress={() => setForm(null)} />
                <Button title="Save product" onPress={save} disabled={!form.sku || !form.name || !form.price} />
              </View>
            </View>
          ) : null}
        </Dialog>
        <Card>
          <T muted size="sm">
            Tip: scanners act as keyboards — scanning a barcode into the POS search box adds the item. Cost is a moving average updated by
            stock receipts.
          </T>
        </Card>
      </Screen>
    </Guard>
  );
}
