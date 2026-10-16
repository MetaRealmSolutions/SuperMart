import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { Guard } from '@/lib/Guard';
import { ApiError, rpc } from '@/lib/api';
import { money, newRef, printReceipt, qtyText, toMinor } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, Chips, Confirm, Dialog, ErrorBox, Field, Notice, T, colors, space } from '@/ui';

interface CartItem {
  productId: number;
  name: string;
  sku: string;
  unit: string;
  weighed: boolean;
  qtyText: string;
  discountPct: string;
}

interface PayLine {
  id: number;
  method: 'cash' | 'card' | 'upi';
  amount: string;
  tendered: string;
  scenario: string;
}

const SCEN: Record<string, [string, string][]> = {
  card: [
    ['approved', 'Approved'],
    ['declined', 'Declined'],
  ],
  upi: [
    ['success', 'Success'],
    ['pending', 'Pending'],
    ['failed', 'Failed'],
  ],
};

const toMilli = (t: string) => Math.round(Number(t) * 1000);

export default function POS() {
  const { can, hasModule } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const searchRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [code, setCode] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDiscPct, setCartDiscPct] = useState('');
  const [coupon, setCoupon] = useState('');
  const [customer, setCustomer] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [lines, setLines] = useState<PayLine[]>([]);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approver, setApprover] = useState({ username: '', pin: '' });
  const [clientRef, setClientRef] = useState(newRef());
  const [result, setResult] = useState<any>(null);
  const [receipt, setReceipt] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const lineId = useRef(1);

  const payload = useCallback(
    () => ({
      items: cart.map((c) => ({
        productId: c.productId,
        qtyMilli: toMilli(c.qtyText),
        ...(Number(c.discountPct) > 0 ? { discountBp: Math.round(Number(c.discountPct) * 100) } : {}),
      })),
      ...(Number(cartDiscPct) > 0 ? { cartDiscountBp: Math.round(Number(cartDiscPct) * 100) } : {}),
      ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
    }),
    [cart, cartDiscPct, coupon],
  );

  // Server prices the cart; the screen never computes money itself.
  useEffect(() => {
    if (cart.length === 0) {
      setQuote(null);
      setQuoteErr(null);
      return;
    }
    if (cart.some((c) => !(toMilli(c.qtyText) > 0))) return;
    let alive = true;
    const t = setTimeout(() => {
      rpc('pos.quote', payload())
        .then((q) => alive && (setQuote(q), setQuoteErr(null)))
        .catch((e) => alive && (setQuote(null), setQuoteErr(e.message)));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [cart, cartDiscPct, coupon, payload]);

  const addProduct = (p: any, qtyMilli?: number) => {
    setCart((prev) => {
      const i = prev.findIndex((c) => c.productId === p.id);
      const add = qtyMilli ?? p.pack_qty_milli ?? 1000;
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], qtyText: String((toMilli(next[i].qtyText) + add) / 1000) };
        return next;
      }
      return [
        ...prev,
        { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, weighed: !!p.is_weighed, qtyText: String(add / 1000), discountPct: '' },
      ];
    });
    setMatches([]);
    setCode('');
    setNotice(null);
    searchRef.current?.focus();
  };

  const lookup = async () => {
    const text = code.trim();
    if (!text) return;
    try {
      const r = await rpc('catalog.lookup', { code: text });
      if (r.matches.length === 0) setNotice(`No product found for "${text}"`);
      else if (r.exact || r.matches.length === 1) addProduct(r.matches[0]);
      else setMatches(r.matches);
    } catch (e: any) {
      setNotice(e.message);
    }
  };

  const total: number = quote?.totalMinor ?? 0;
  const paid = lines.reduce((a, l) => a + (toMinor(l.amount) ?? 0), 0);
  const remaining = total - paid;

  const openPay = () => {
    if (!quote) return;
    setPayErr(null);
    setLines([{ id: lineId.current++, method: 'cash', amount: (total / 100).toFixed(2), tendered: '', scenario: 'approved' }]);
    setPayOpen(true);
  };

  const addLine = (method: PayLine['method']) =>
    setLines((l) => [
      ...l,
      {
        id: lineId.current++,
        method,
        amount: remaining > 0 ? (remaining / 100).toFixed(2) : '',
        tendered: '',
        scenario: method === 'upi' ? 'success' : 'approved',
      },
    ]);

  const pay = async () => {
    setBusy(true);
    setPayErr(null);
    try {
      const payments = lines.map((l) => ({
        method: l.method,
        amountMinor: toMinor(l.amount) ?? 0,
        ...(l.method === 'cash' && l.tendered ? { tenderedMinor: toMinor(l.tendered) ?? undefined } : {}),
        ...(l.method !== 'cash' ? { scenario: l.scenario } : {}),
      }));
      const r = await rpc('pos.checkout', {
        ...payload(),
        clientRef,
        customerName: customer || undefined,
        payments,
        ...(approver.username ? { approval: approver } : {}),
      });
      const rc = await rpc('pos.receipt', { saleId: r.sale.id });
      setResult(r);
      setReceipt(rc.lines);
      setPayOpen(false);
    } catch (e) {
      const err = e as ApiError;
      setPayErr(err.message);
    }
    setBusy(false);
  };

  const resolve = async (outcome: 'success' | 'failed') => {
    try {
      const r = await rpc('pos.resolvePayment', { saleId: result.sale.id, outcome });
      const rc = await rpc('pos.receipt', { saleId: r.sale.id });
      setResult(r);
      setReceipt(rc.lines);
    } catch (e: any) {
      setNotice(e.message);
    }
  };

  const reset = () => {
    setCart([]);
    setCartDiscPct('');
    setCoupon('');
    setCustomer('');
    setQuote(null);
    setResult(null);
    setReceipt([]);
    setApprover({ username: '', pin: '' });
    setClientRef(newRef());
    setNotice(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  // Keyboard shortcuts (web): F2 search, F4 pay, F9 clear, Esc close.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F4' && !payOpen && !result) {
        e.preventDefault();
        openPay();
      } else if (e.key === 'F9' && !result) {
        e.preventDefault();
        if (cart.length) setConfirmClear(true);
      } else if (e.key === 'Escape') {
        setPayOpen(false);
        setMatches([]);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const setQty = (i: number, text: string) =>
    setCart((c) => c.map((x, idx) => (idx === i ? { ...x, qtyText: text.replace(/[^0-9.]/g, '') } : x)));
  const bump = (i: number, dir: 1 | -1) =>
    setCart((c) =>
      c.flatMap((x, idx) => {
        if (idx !== i) return [x];
        const step = x.weighed ? 500 : 1000;
        const n = toMilli(x.qtyText) + dir * step;
        return n <= 0 ? [] : [{ ...x, qtyText: String(n / 1000) }];
      }),
    );

  const cartPanel = (
    <Card style={{ flex: 1, minHeight: 320 }} title={`Cart (${cart.length})`}>
      {cart.length === 0 ? <T muted>Scan a barcode or search a product to start a sale.</T> : null}
      {cart.map((c, i) => {
        const ql = quote?.lines?.find((l: any) => l.productId === c.productId);
        return (
          <View
            key={c.productId}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 8,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              flexWrap: 'wrap',
            }}
          >
            <View style={{ flex: 1, minWidth: 180 }}>
              <T bold>{c.name}</T>
              <T size="sm" muted>
                {c.sku} · {money(ql?.unitPriceMinor)} / {c.unit}
                {ql && ql.manualDiscountMinor + ql.promoDiscountMinor + ql.cartDiscountMinor > 0
                  ? ` · discount ${money(ql.manualDiscountMinor + ql.promoDiscountMinor + ql.cartDiscountMinor)}`
                  : ''}
              </T>
            </View>
            <Button title="−" small kind="secondary" onPress={() => bump(i, -1)} />
            <TextInput
              accessibilityLabel={`Quantity for ${c.name}`}
              value={c.qtyText}
              onChangeText={(t) => setQty(i, t)}
              keyboardType="decimal-pad"
              style={{
                width: 72,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 6,
                padding: 6,
                textAlign: 'right',
                fontSize: 16,
              }}
            />
            <Button title="+" small kind="secondary" onPress={() => bump(i, 1)} />
            {can('pos.discount') ? (
              <TextInput
                accessibilityLabel={`Discount percent for ${c.name}`}
                placeholder="% off"
                placeholderTextColor={colors.muted}
                value={c.discountPct}
                onChangeText={(t) =>
                  setCart((cc) => cc.map((x, idx) => (idx === i ? { ...x, discountPct: t.replace(/[^0-9.]/g, '') } : x)))
                }
                keyboardType="decimal-pad"
                style={{ width: 62, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 6 }}
              />
            ) : null}
            <T bold style={{ width: 90, textAlign: 'right' }}>
              {ql ? money(ql.netMinor) : '…'}
            </T>
            <Button title="✕" small kind="ghost" onPress={() => setCart((cc) => cc.filter((_, idx) => idx !== i))} />
          </View>
        );
      })}
    </Card>
  );

  const totalsPanel = (
    <Card style={{ width: wide ? 340 : undefined }}>
      <T muted size="sm">
        Subtotal
      </T>
      <T size="lg">{money(quote?.grossMinor)}</T>
      <T muted size="sm" style={{ marginTop: 6 }}>
        Discounts
      </T>
      <T size="lg">−{money(quote?.discountMinor)}</T>
      <T muted size="sm" style={{ marginTop: 6 }}>{`Tax included`}</T>
      <T>{money(quote?.taxMinor)}</T>
      <View style={{ marginVertical: 10, paddingVertical: 10, borderTopWidth: 2, borderBottomWidth: 2, borderColor: colors.primary }}>
        <T muted size="sm">
          TOTAL
        </T>
        <T size="xxl" bold color={colors.primaryDark} testID="pos-total">
          {money(total)}
        </T>
      </View>
      {can('pos.discount') ? (
        <Field
          label="Bill discount %"
          value={cartDiscPct}
          onChangeText={(t) => setCartDiscPct(t.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
        />
      ) : null}
      {hasModule('pricing') ? (
        <Field
          label="Coupon code"
          value={coupon}
          onChangeText={setCoupon}
          autoCapitalize="characters"
          hint={quote?.couponCode && quote.couponDiscountMinor > 0 ? `Coupon applied: −${money(quote.couponDiscountMinor)}` : undefined}
        />
      ) : null}
      <Field label="Customer (optional)" value={customer} onChangeText={setCustomer} />
      {quote?.needsApproval ? (
        <Notice
          tone="warn"
          text={
            can('pos.discount_unlimited')
              ? 'Large discount (you may approve it).'
              : hasModule('advanced_pos')
                ? 'Discount above your limit: manager approval will be requested at payment.'
                : 'Discount above your limit: a manager must apply it.'
          }
        />
      ) : null}
      <ErrorBox error={quoteErr} />
      <Button
        title="Pay  (F4)"
        onPress={openPay}
        disabled={!quote || cart.length === 0}
        style={{ marginTop: 10, paddingVertical: 16 }}
        testID="pos-pay"
      />
      <Button
        title="Clear  (F9)"
        kind="secondary"
        onPress={() => setConfirmClear(true)}
        disabled={cart.length === 0}
        style={{ marginTop: 8 }}
      />
    </Card>
  );

  return (
    <Guard perm="pos.sell">
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextInput
            ref={searchRef}
            autoFocus
            accessibilityLabel="Scan barcode or search product"
            testID="pos-search"
            placeholder="Scan barcode / type SKU or name, press Enter  (F2)"
            placeholderTextColor={colors.muted}
            value={code}
            onChangeText={setCode}
            onSubmitEditing={lookup}
            style={{
              flex: 1,
              minWidth: 260,
              borderWidth: 2,
              borderColor: colors.primary,
              borderRadius: 8,
              padding: 12,
              fontSize: 18,
              backgroundColor: '#fff',
            }}
          />
          <Button title="Add" onPress={lookup} />
          <Badge text="DEMO PAYMENTS" tone="demo" />
        </View>
        {notice ? <Notice text={notice} tone="warn" /> : null}
        {matches.length > 0 ? (
          <Card title="Select product">
            {matches.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => addProduct(m)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  padding: 10,
                  backgroundColor: pressed ? colors.primarySoft : '#fff',
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                })}
              >
                <T>
                  {m.name}{' '}
                  <T muted size="sm">
                    ({m.sku})
                  </T>
                </T>
                <T>
                  {money(m.price_minor)} · {m.available_milli > 0 ? `${qtyText(m.available_milli, m.unit)} in stock` : 'OUT OF STOCK'}
                </T>
              </Pressable>
            ))}
          </Card>
        ) : null}
        <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', gap: space.md }}>
          {cartPanel}
          {totalsPanel}
        </View>

        <Dialog visible={payOpen} title={`Payment — ${money(total)}`} onClose={() => setPayOpen(false)} width={640}>
          <Badge text="DEMO / MOCK — no real card, UPI or bank is contacted" tone="demo" />
          <ErrorBox error={payErr} />
          {payErr && /approval|exceeds your limit/i.test(payErr) && hasModule('advanced_pos') ? (
            <Card title="Manager approval">
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Field
                  label="Manager username"
                  value={approver.username}
                  onChangeText={(v) => setApprover({ ...approver, username: v.toLowerCase() })}
                  autoCapitalize="none"
                />
                <Field
                  label="Manager PIN"
                  value={approver.pin}
                  onChangeText={(v) => setApprover({ ...approver, pin: v })}
                  secureTextEntry
                  keyboardType="number-pad"
                />
              </View>
            </Card>
          ) : null}
          {lines.map((l) => {
            const amt = toMinor(l.amount) ?? 0;
            const tendered = l.tendered ? toMinor(l.tendered) : null;
            return (
              <Card
                key={l.id}
                style={{ marginTop: 8 }}
                title={l.method.toUpperCase()}
                right={<Button title="Remove" kind="ghost" small onPress={() => setLines((x) => x.filter((y) => y.id !== l.id))} />}
              >
                <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                  <Field
                    label="Amount"
                    value={l.amount}
                    onChangeText={(v) => setLines((x) => x.map((y) => (y.id === l.id ? { ...y, amount: v } : y)))}
                    keyboardType="decimal-pad"
                  />
                  {l.method === 'cash' ? (
                    <Field
                      label="Cash tendered"
                      value={l.tendered}
                      onChangeText={(v) => setLines((x) => x.map((y) => (y.id === l.id ? { ...y, tendered: v } : y)))}
                      keyboardType="decimal-pad"
                      hint={tendered && tendered >= amt ? `Change: ${money(tendered - amt)}` : undefined}
                    />
                  ) : null}
                </View>
                {l.method !== 'cash' ? (
                  <Chips
                    label="Demo scenario"
                    options={SCEN[l.method].map(([value, label]) => ({ value, label }))}
                    value={l.scenario}
                    onChange={(v) => setLines((x) => x.map((y) => (y.id === l.id ? { ...y, scenario: v } : y)))}
                  />
                ) : null}
              </Card>
            );
          })}
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12, flexWrap: 'wrap' }}>
            <Button title="+ Cash" kind="secondary" small onPress={() => addLine('cash')} />
            <Button title="+ Card (demo)" kind="secondary" small onPress={() => addLine('card')} />
            <Button title="+ UPI (demo)" kind="secondary" small onPress={() => addLine('upi')} />
            <T bold color={remaining === 0 ? colors.primaryDark : colors.danger} style={{ marginLeft: 'auto' }}>
              {remaining === 0 ? 'Fully allocated' : remaining > 0 ? `Remaining ${money(remaining)}` : `Over by ${money(-remaining)}`}
            </T>
          </View>
          <Button
            title="Confirm payment"
            onPress={pay}
            loading={busy}
            disabled={remaining !== 0 || lines.length === 0}
            testID="pos-confirm"
          />
        </Dialog>

        <Dialog
          visible={!!result}
          title={
            result?.sale.status === 'completed'
              ? 'Sale complete'
              : result?.sale.status === 'pending_payment'
                ? 'Awaiting UPI confirmation'
                : `Sale ${result?.sale.status}`
          }
          onClose={reset}
          width={520}
        >
          {result?.sale.status === 'pending_payment' ? (
            <View style={{ marginBottom: 8 }}>
              <Notice
                tone="warn"
                text="A demo UPI payment is pending. Stock is held for this bill. Confirm or fail the payment to continue."
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Button title="Customer paid (success)" onPress={() => resolve('success')} />
                <Button title="Payment failed" kind="danger" onPress={() => resolve('failed')} />
              </View>
            </View>
          ) : null}
          <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, padding: 10 }}>
            {receipt.map((ln, i) => (
              <Text2 key={i}>{ln}</Text2>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <Button title="Print receipt" kind="secondary" onPress={() => printReceipt(receipt)} />
            <Button title="New sale" onPress={reset} testID="pos-new" />
          </View>
        </Dialog>

        <Confirm
          visible={confirmClear}
          danger
          title="Clear this sale?"
          message="All items in the cart will be removed."
          confirmLabel="Clear cart"
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            reset();
          }}
        />
        <T size="sm" muted>
          Shortcuts: F2 search · F4 pay · F9 clear · Esc close dialogs.
        </T>
      </View>
    </Guard>
  );
}

function Text2({ children }: { children: React.ReactNode }) {
  return (
    <T style={{ fontFamily: Platform.OS === 'web' ? 'Consolas, "Courier New", monospace' : 'monospace', fontSize: 12, lineHeight: 16 }}>
      {children as string}
    </T>
  );
}
