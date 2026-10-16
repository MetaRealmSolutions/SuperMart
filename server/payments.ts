import type { Ctx } from './ctx';

/**
 * DEMO / MOCK payment adapter. Deterministic: the operator chooses the scenario explicitly, nothing is random.
 * No card number, CVV, UPI PIN or bank credential is ever accepted, logged or stored.
 */
export type PaymentMethod = 'cash' | 'card' | 'upi';
export type PaymentScenario = 'approved' | 'declined' | 'success' | 'pending' | 'failed';
export type PaymentStatus = 'approved' | 'pending' | 'declined' | 'failed';

export interface PaymentResult {
  status: PaymentStatus;
  reference: string;
  message: string;
}

export const SCENARIOS: Record<PaymentMethod, PaymentScenario[]> = {
  cash: ['approved'],
  card: ['approved', 'declined'],
  upi: ['success', 'pending', 'failed'],
};

function nextRef(ctx: Ctx, prefix: string): string {
  return `MOCK-${prefix}-${String(ctx.nextCounter('payref')).padStart(6, '0')}`;
}

export function authorize(ctx: Ctx, method: PaymentMethod, scenario: PaymentScenario | undefined): PaymentResult {
  const s = scenario ?? (method === 'upi' ? 'success' : 'approved');
  if (!SCENARIOS[method].includes(s)) throw new Error(`Scenario "${s}" is not valid for ${method}`);
  const reference = nextRef(ctx, method.toUpperCase());
  switch (`${method}:${s}`) {
    case 'cash:approved':
      return { status: 'approved', reference, message: 'DEMO cash accepted' };
    case 'card:approved':
      return { status: 'approved', reference, message: 'DEMO card approved (simulated)' };
    case 'card:declined':
      return { status: 'declined', reference, message: 'DEMO card declined (simulated)' };
    case 'upi:success':
      return { status: 'approved', reference, message: 'DEMO UPI success (simulated)' };
    case 'upi:pending':
      return { status: 'pending', reference, message: 'DEMO UPI awaiting customer confirmation (simulated)' };
    default:
      return { status: 'failed', reference, message: 'DEMO UPI failed (simulated)' };
  }
}

/** Mock refunds always succeed unless the caller asks to demonstrate a failure. */
export function refund(ctx: Ctx, method: PaymentMethod, fail = false): PaymentResult {
  const reference = nextRef(ctx, 'RF');
  return fail
    ? { status: 'failed', reference, message: `DEMO ${method} refund failed (simulated)` }
    : { status: 'approved', reference, message: `DEMO ${method} refund issued (simulated)` };
}
