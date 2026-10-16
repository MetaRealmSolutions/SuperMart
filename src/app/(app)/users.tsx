import React, { useState } from 'react';
import { View } from 'react-native';
import { Guard } from '@/lib/Guard';
import { rpc } from '@/lib/api';
import { Badge, Button, Chips, DataTable, Dialog, ErrorBox, Field, Loading, Notice, Screen, T, useQuery, type Column } from '@/ui';
import { ROLES } from '../../../shared/permissions';

export default function Users() {
  const list = useQuery(() => rpc<any[]>('users.list'), []);
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    try {
      await rpc('users.save', {
        id: form.id,
        username: form.username,
        name: form.name,
        role: form.role,
        active: form.active,
        ...(form.pin ? { pin: form.pin } : {}),
      });
      setMsg(`Saved ${form.username}`);
      setForm(null);
      list.reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const cols: Column<any>[] = [
    { key: 'username', title: 'Username', width: 140 },
    { key: 'name', title: 'Name', flex: 2 },
    { key: 'role', title: 'Role', width: 170, render: (r) => <Badge text={r.role.replace('_', ' ')} tone="info" /> },
    {
      key: 'active',
      title: 'Status',
      width: 100,
      render: (r) => <Badge text={r.active ? 'Active' : 'Disabled'} tone={r.active ? 'good' : 'neutral'} />,
    },
  ];

  return (
    <Guard perm="users.manage">
      <Screen
        title="Users"
        subtitle="Accounts and roles"
        actions={
          <Button
            title="Add user"
            onPress={() => {
              setError(null);
              setForm({ username: '', name: '', role: 'cashier', pin: '', active: true });
            }}
          />
        }
      >
        {msg ? <Notice text={msg} tone="good" /> : null}
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={list.data ?? []}
            columns={cols}
            rowKey={(r) => r.id}
            searchKeys={['username', 'name', 'role']}
            onRowPress={(r) => {
              setError(null);
              setForm({ ...r, active: !!r.active, pin: '' });
            }}
          />
        )}
        <Dialog visible={!!form} title={form?.id ? 'Edit user' : 'New user'} onClose={() => setForm(null)}>
          {form ? (
            <View>
              <ErrorBox error={error} />
              <Field
                label="Username (lowercase)"
                value={form.username}
                onChangeText={(v) => setForm({ ...form, username: v.toLowerCase() })}
                autoCapitalize="none"
              />
              <Field label="Full name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
              <Chips
                label="Role"
                options={ROLES.map((r) => ({ value: r, label: r.replace('_', ' ') }))}
                value={form.role}
                onChange={(v) => setForm({ ...form, role: v })}
              />
              <Field
                label={form.id ? 'New PIN (leave blank to keep)' : 'PIN (4–8 digits)'}
                value={form.pin}
                onChangeText={(v) => setForm({ ...form, pin: v.replace(/\D/g, '') })}
                secureTextEntry
                keyboardType="number-pad"
              />
              <Chips
                label="Status"
                options={[
                  { value: 'a', label: 'Active' },
                  { value: 'd', label: 'Disabled' },
                ]}
                value={form.active ? 'a' : 'd'}
                onChange={(v) => setForm({ ...form, active: v === 'a' })}
              />
              <T size="sm" muted style={{ marginBottom: 8 }}>
                Role changes and PIN resets are written to the audit log.
              </T>
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
                <Button title="Cancel" kind="secondary" onPress={() => setForm(null)} />
                <Button title="Save" onPress={save} />
              </View>
            </View>
          ) : null}
        </Dialog>
      </Screen>
    </Guard>
  );
}
