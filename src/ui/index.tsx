import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, font, radius, space } from './theme';

export { colors, font, radius, space };

export function T({
  children,
  style,
  bold,
  muted,
  size,
  color,
  ...rest
}: {
  children?: React.ReactNode;
  style?: any;
  bold?: boolean;
  muted?: boolean;
  size?: keyof typeof font;
  color?: string;
} & React.ComponentProps<typeof Text>) {
  return (
    <Text
      {...rest}
      style={[
        { color: muted ? colors.muted : (color ?? colors.text), fontSize: font[size ?? 'md'], fontWeight: bold ? '700' : '400' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
  testID,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  testID?: string;
  small?: boolean;
}) {
  const bg =
    kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : kind === 'secondary' ? colors.surface : 'transparent';
  const fg = kind === 'secondary' ? colors.text : kind === 'ghost' ? colors.primary : '#fff';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled || !!loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        small && { paddingVertical: 5, paddingHorizontal: 10 },
        { backgroundColor: bg, borderColor: kind === 'secondary' ? colors.border : bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={{ color: fg, fontWeight: '600', fontSize: small ? font.sm : font.md }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  style,
  title,
  right,
}: {
  children?: React.ReactNode;
  style?: ViewStyle;
  title?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={[styles.card, style]}>
      {title ? (
        <View style={styles.cardHead}>
          <T bold size="lg">
            {title}
          </T>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Field({ label, error, hint, ...rest }: { label: string; error?: string; hint?: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: space.md, flexGrow: 1, minWidth: 140 }}>
      <T size="sm" bold style={{ marginBottom: 4 }}>
        {label}
      </T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...rest}
        style={[styles.input, error ? { borderColor: colors.danger } : null, rest.style]}
      />
      {hint && !error ? (
        <T size="sm" muted>
          {hint}
        </T>
      ) : null}
      {error ? (
        <T size="sm" color={colors.danger}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'demo' }) {
  const map = {
    neutral: [colors.border, colors.text],
    good: [colors.primarySoft, colors.primaryDark],
    warn: [colors.warnSoft, colors.warn],
    bad: [colors.dangerSoft, colors.danger],
    info: [colors.infoSoft, colors.info],
    demo: ['#f1e4fb', colors.demo],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export const statusTone = (s: string): 'good' | 'warn' | 'bad' | 'info' | 'neutral' =>
  ['completed', 'approved', 'received', 'closed', 'confirmed', 'paid', 'approved_po', 'sellable', 'success'].includes(s)
    ? 'good'
    : [
          'pending',
          'pending_payment',
          'requested',
          'dispatched',
          'open',
          'partial',
          'draft',
          'submitted',
          'in_progress',
          'quarantine',
        ].includes(s)
      ? 'warn'
      : ['cancelled', 'voided', 'declined', 'failed', 'rejected', 'damaged', 'expired', 'discrepancy'].includes(s)
        ? 'bad'
        : 'neutral';

export function Screen({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, gap: space.lg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: space.md }}>
        <View style={{ flexShrink: 1 }}>
          <T size="xl" bold accessibilityRole="header">
            {title}
          </T>
          {subtitle ? <T muted>{subtitle}</T> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>{actions}</View>
      </View>
      {children}
    </ScrollView>
  );
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <View style={[styles.notice, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]} accessibilityRole="alert">
      <T color={colors.danger} style={{ flex: 1 }}>
        {error}
      </T>
      {onRetry ? <Button title="Retry" kind="secondary" small onPress={onRetry} /> : null}
    </View>
  );
}

export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'good' | 'warn' }) {
  const [bg, fg] =
    tone === 'good'
      ? [colors.primarySoft, colors.primaryDark]
      : tone === 'warn'
        ? [colors.warnSoft, colors.warn]
        : [colors.infoSoft, colors.info];
  return (
    <View style={[styles.notice, { backgroundColor: bg, borderColor: fg }]}>
      <T color={fg}>{text}</T>
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }}>
      <T bold>{title}</T>
      {hint ? <T muted>{hint}</T> : null}
    </View>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={{ padding: space.xl, alignItems: 'center', gap: 8 }}>
      <ActivityIndicator color={colors.primary} />
      <T muted>{text}</T>
    </View>
  );
}

export function Dialog({
  visible,
  title,
  onClose,
  children,
  width = 520,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  width?: number;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { width }]} accessibilityViewIsModal>
          <View style={styles.cardHead}>
            <T bold size="lg">
              {title}
            </T>
            <Button title="Close" kind="ghost" small onPress={onClose} />
          </View>
          <ScrollView>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Confirmation for destructive or financially sensitive actions. */
export function Confirm({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog visible={visible} title={title} onClose={onCancel} width={440}>
      <T style={{ marginBottom: space.lg }}>{message}</T>
      <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end' }}>
        <Button title="Cancel" kind="secondary" onPress={onCancel} />
        <Button title={confirmLabel} kind={danger ? 'danger' : 'primary'} onPress={onConfirm} />
      </View>
    </Dialog>
  );
}

export function Chips<V extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  label?: string;
}) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label ? (
        <T size="sm" bold style={{ marginBottom: 4 }}>
          {label}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: o.value === value }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, o.value === value && { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
            <Text style={{ color: o.value === value ? '#fff' : colors.text, fontSize: font.sm }}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export interface Column<R> {
  key: string;
  title: string;
  width?: number;
  flex?: number;
  align?: 'left' | 'right';
  render?: (row: R) => React.ReactNode;
  sortValue?: (row: R) => string | number;
  csv?: (row: R) => string | number;
}

/** Client-side table with search, sorting and pagination for medium lists. */
export function DataTable<R extends Record<string, any>>({
  rows,
  columns,
  rowKey,
  searchKeys,
  pageSize = 15,
  onRowPress,
  empty,
  toolbar,
}: {
  rows: R[];
  columns: Column<R>[];
  rowKey: (r: R) => string | number;
  searchKeys?: (keyof R)[];
  pageSize?: number;
  onRowPress?: (r: R) => void;
  empty?: string;
  toolbar?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out =
      needle && searchKeys
        ? rows.filter((r) =>
            searchKeys.some((k) =>
              String(r[k] ?? '')
                .toLowerCase()
                .includes(needle),
            ),
          )
        : rows;
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (r: R) => (col?.sortValue ? col.sortValue(r) : (r[sort.key] ?? ''));
      out = [...out].sort((a, b) => (val(a) > val(b) ? sort.dir : val(a) < val(b) ? -sort.dir : 0));
    }
    return out;
  }, [rows, q, sort, searchKeys, columns]);
  useEffect(() => setPage(0), [q, rows.length]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const slice = filtered.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap', marginBottom: space.sm }}>
        {searchKeys ? (
          <TextInput
            accessibilityLabel="Search table"
            placeholder="Search…"
            placeholderTextColor={colors.muted}
            value={q}
            onChangeText={setQ}
            style={[styles.input, { minWidth: 220 }]}
          />
        ) : null}
        {toolbar}
        <T muted size="sm" style={{ marginLeft: 'auto' }}>
          {filtered.length} row{filtered.length === 1 ? '' : 's'}
        </T>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ minWidth: '100%' }}>
          <View style={[styles.tr, { backgroundColor: colors.bg }]}>
            {columns.map((c) => (
              <Pressable
                key={c.key}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${c.title}`}
                onPress={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}
                style={cell(c)}
              >
                <T size="sm" bold style={{ textAlign: c.align ?? 'left' }}>
                  {c.title}
                  {sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                </T>
              </Pressable>
            ))}
          </View>
          {slice.length === 0 ? <Empty title={empty ?? 'Nothing to show'} /> : null}
          {slice.map((r) => (
            <Pressable
              key={rowKey(r)}
              disabled={!onRowPress}
              onPress={() => onRowPress?.(r)}
              style={({ pressed }) => [styles.tr, pressed && onRowPress ? { backgroundColor: colors.primarySoft } : null]}
            >
              {columns.map((c) => (
                <View key={c.key} style={cell(c)}>
                  {c.render ? (
                    c.render(r)
                  ) : (
                    <T size="sm" style={{ textAlign: c.align ?? 'left' }}>
                      {String(r[c.key] ?? '')}
                    </T>
                  )}
                </View>
              ))}
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {pages > 1 ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'flex-end', marginTop: space.sm }}>
          <Button title="Prev" small kind="secondary" disabled={page === 0} onPress={() => setPage(page - 1)} />
          <T size="sm">
            Page {page + 1} / {pages}
          </T>
          <Button title="Next" small kind="secondary" disabled={page >= pages - 1} onPress={() => setPage(page + 1)} />
        </View>
      ) : null}
    </View>
  );
}

const cell = (c: { width?: number; flex?: number; align?: 'left' | 'right' }): ViewStyle => ({
  width: c.width,
  flex: c.width ? undefined : (c.flex ?? 1),
  minWidth: c.width ?? 90,
  paddingHorizontal: 8,
  paddingVertical: 8,
  justifyContent: 'center',
  alignItems: c.align === 'right' ? 'flex-end' : 'flex-start',
});

/** Download rows as CSV in the browser (web only). */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]): void {
  if (Platform.OS !== 'web') return;
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Small async data hook: { data, error, loading, reload }. */
export function useQuery<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: radius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  card: { backgroundColor: colors.surface, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: '#fff',
  },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius, borderWidth: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,20,15,0.5)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  dialog: { backgroundColor: colors.surface, borderRadius: radius, padding: space.lg, maxWidth: '100%', maxHeight: '90%' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
});
