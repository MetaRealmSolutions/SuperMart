import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { rpc } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, Chips, Confirm, ErrorBox, Field, Loading, Notice, Screen, T, useQuery } from '@/ui';

const EDITIONS = [
  { value: 'basic', label: 'Basic Mart' },
  { value: 'inventory', label: 'Inventory Mart' },
  { value: 'full', label: 'Full Mart' },
];

const SETTING_FIELDS: [string, string][] = [
  ['store_name', 'Store name'],
  ['store_address', 'Address'],
  ['store_phone', 'Phone'],
  ['gstin', 'GSTIN / tax id'],
  ['receipt_footer', 'Receipt footer'],
  ['receipt_width_chars', 'Receipt width (chars)'],
  ['printer_name', 'Printer (label)'],
  ['max_cashier_discount_pct', 'Max cashier discount %'],
];

export default function Settings() {
  const { can, refresh } = useSession();
  const mods = useQuery(() => rpc<any[]>('modules.list'), []);
  const settings = useQuery(() => rpc<Record<string, string>>('settings.get'), []);
  const info = useQuery(() => rpc<any>('system.info'), []);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ text: string; tone: 'good' | 'warn' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetEdition, setResetEdition] = useState('full');
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    try {
      await fn();
      setMsg({ text: ok, tone: 'good' });
      mods.reload();
      settings.reload();
      info.reload();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggle = (id: string, enabled: boolean) => {
    const next = (mods.data ?? []).filter((m) => (m.id === id ? enabled : m.enabled)).map((m) => m.id);
    run(() => rpc('modules.set', { enabled: next }), `Module ${id} ${enabled ? 'enabled' : 'disabled'}. Existing data is preserved.`);
  };

  return (
    <Guard perm="catalog.view">
      <Screen title="Settings & Modules" subtitle="Store configuration, client edition and feature entitlements">
        <ErrorBox error={error} />
        {msg ? <Notice text={msg.text} tone={msg.tone} /> : null}
        {can('modules.manage') ? (
          <Card title="Edition (module entitlements)">
            <T muted style={{ marginBottom: 8 }}>
              Applies a named bundle of modules. Disabling a module hides it and blocks its operations; it never deletes data.
            </T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {EDITIONS.map((e) => (
                <Button
                  key={e.value}
                  title={`Apply ${e.label}`}
                  kind="secondary"
                  onPress={() => run(() => rpc('modules.applyEdition', { edition: e.value }), `${e.label} applied.`)}
                />
              ))}
            </View>
          </Card>
        ) : null}
        <Card title="Modules">
          {mods.loading ? <Loading /> : null}
          {(mods.data ?? []).map((m) => (
            <View
              key={m.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: '#eef1f4',
                flexWrap: 'wrap',
              }}
            >
              <View style={{ flex: 1, minWidth: 240 }}>
                <T bold>
                  {m.letter !== '-' ? `${m.letter}. ` : ''}
                  {m.name}
                </T>
                <T size="sm" muted>
                  {m.description}
                  {m.dependsOn.length ? ` Requires: ${m.dependsOn.join(', ')}.` : ''}
                </T>
              </View>
              <Badge text={m.mandatory ? 'ALWAYS ON' : m.enabled ? 'ENABLED' : 'DISABLED'} tone={m.enabled ? 'good' : 'neutral'} />
              {can('modules.manage') && !m.mandatory ? (
                <Button small kind="secondary" title={m.enabled ? 'Disable' : 'Enable'} onPress={() => toggle(m.id, !m.enabled)} />
              ) : null}
            </View>
          ))}
        </Card>
        {can('settings.manage') ? (
          <Card title="Store & receipt settings">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {SETTING_FIELDS.map(([k, label]) => (
                <Field key={k} label={label} value={form[k] ?? ''} onChangeText={(v) => setForm({ ...form, [k]: v })} />
              ))}
            </View>
            <Button
              title="Save settings"
              onPress={() =>
                run(
                  () => rpc('settings.set', { values: Object.fromEntries(SETTING_FIELDS.map(([k]) => [k, form[k] ?? ''])) }),
                  'Settings saved.',
                )
              }
            />
          </Card>
        ) : null}
        <Card title="About / diagnostics">
          {info.data ? (
            <>
              <T>
                Version {info.data.version} · Edition: {info.data.edition} · Node {info.data.node}
              </T>
              <T muted size="sm">
                Migrations applied: {info.data.migrations.join(', ')}
              </T>
              <T muted size="sm">
                {info.data.payments}
              </T>
            </>
          ) : (
            <Loading />
          )}
        </Card>
        {can('demo.reset') ? (
          <Card title="Demo data">
            <T muted style={{ marginBottom: 8 }}>
              Restores the documented demo baseline (users, products, stock, history). All current data is replaced.
            </T>
            <Chips options={EDITIONS} value={resetEdition} onChange={setResetEdition} label="Edition after reset" />
            <Button title="Reset demo data…" kind="danger" onPress={() => setConfirmReset(true)} />
          </Card>
        ) : null}
        <Confirm
          visible={confirmReset}
          danger
          title="Reset all demo data?"
          message="This permanently replaces ALL data with the demo baseline and signs everyone out."
          confirmLabel="Reset"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            run(() => rpc('system.resetDemo', { edition: resetEdition, confirm: 'RESET' }), 'Demo data reset.');
          }}
        />
      </Screen>
    </Guard>
  );
}
