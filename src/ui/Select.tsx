import React, { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Button, Dialog, T, colors, space } from './index';

export interface Option<V> {
  value: V;
  label: string;
}

/** Searchable picker in a dialog; works for long lists (products, locations, suppliers). */
export function Select<V extends string | number>({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select…',
  allowClear,
}: {
  label: string;
  options: Option<V>[];
  value: V | null | undefined;
  onChange: (v: V | null) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 100);
  return (
    <View style={{ marginBottom: space.md, flexGrow: 1, minWidth: 160 }}>
      <T size="sm" bold style={{ marginBottom: 4 }}>
        {label}
      </T>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? 'none'}`}
        onPress={() => setOpen(true)}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 9,
          backgroundColor: '#fff',
        }}
      >
        <T color={current ? colors.text : colors.muted}>{current?.label ?? placeholder}</T>
      </Pressable>
      <Dialog visible={open} title={label} onClose={() => setOpen(false)} width={460}>
        <TextInput
          autoFocus
          accessibilityLabel={`Search ${label}`}
          placeholder="Type to filter…"
          value={q}
          onChangeText={setQ}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, marginBottom: space.sm }}
        />
        {allowClear ? (
          <Button
            title="Clear selection"
            kind="ghost"
            small
            onPress={() => {
              onChange(null);
              setOpen(false);
            }}
          />
        ) : null}
        <ScrollView style={{ maxHeight: 360 }}>
          {shown.map((o) => (
            <Pressable
              key={String(o.value)}
              accessibilityRole="button"
              onPress={() => {
                onChange(o.value);
                setOpen(false);
                setQ('');
              }}
              style={({ pressed }) => ({
                padding: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                backgroundColor: pressed || o.value === value ? colors.primarySoft : '#fff',
              })}
            >
              <T>{o.label}</T>
            </Pressable>
          ))}
          {shown.length === 0 ? (
            <T muted style={{ padding: 10 }}>
              No matches
            </T>
          ) : null}
        </ScrollView>
      </Dialog>
    </View>
  );
}
