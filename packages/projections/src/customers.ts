/**
 * Customer profiles, credit limits, running balances, and statements.
 * Pure commutative projection.
 *
 * - Profiles use field-level Last-Writer-Wins by HLC.
 * - Balances are an additive sum of deltas (credit sales increase balance; repayments & voids decrease).
 * - Held voids handle out-of-order replication (void arrives before credit sale).
 */
import { compareHlc, type NdekoEvent } from '@ndeko/core';
import type { Projection } from '@ndeko/core';
import type {
  CustomerUpsertedV1,
  PaymentReceivedV1,
  SaleRecordedV1,
  SaleVoidedV1,
} from '@ndeko/schemas';

export interface CustomerRecord {
  readonly name?: string | undefined;
  readonly nameHlc?: string | undefined;
  readonly phone?: string | undefined;
  readonly phoneHlc?: string | undefined;
  readonly creditLimitKobo?: number | undefined;
  readonly creditLimitHlc?: string | undefined;
  readonly archived?: boolean | undefined;
  readonly archivedHlc?: string | undefined;
}

export interface CustomerTransaction {
  readonly id: string;
  readonly type: 'CREDIT_SALE' | 'PAYMENT' | 'VOID';
  readonly hlc: string;
  /** Positive for credit debt added; negative for repayment or void */
  readonly amountKobo: number;
  readonly refId: string;
  readonly note?: string | undefined;
  readonly createdAt: number;
}

export interface CustomersState {
  readonly customers: Readonly<Record<string, CustomerRecord>>;
  /** Running credit balance in kobo. Positive = customer owes shop. */
  readonly balances: Readonly<Record<string, number>>;
  /** Ledger transactions per customer keyed by transaction id: customerId -> (txnId -> txn) */
  readonly transactions: Readonly<Record<string, Readonly<Record<string, CustomerTransaction>>>>;
  /** Index of credit sales: saleId -> { customerId, creditKobo } */
  readonly creditSales: Readonly<Record<string, { customerId: string; creditKobo: number }>>;
  /** Held voids where void arrived before credit sale */
  readonly heldCreditVoids: Readonly<Record<string, NdekoEvent<SaleVoidedV1>>>;
}

export interface CustomerView {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly creditLimitKobo: number;
  readonly balanceKobo: number;
  readonly availableCreditKobo: number;
  readonly isOverLimit: boolean;
  readonly archived: boolean;
}

function applyFieldLww<T>(
  currentVal: T | undefined,
  currentHlc: string | undefined,
  incomingVal: T | undefined,
  incomingHlc: string,
): { val: T | undefined; hlc: string | undefined } {
  if (incomingVal === undefined) return { val: currentVal, hlc: currentHlc };
  if (currentHlc === undefined || compareHlc(incomingHlc, currentHlc) > 0) {
    return { val: incomingVal, hlc: incomingHlc };
  }
  return { val: currentVal, hlc: currentHlc };
}

export const customersProjection: Projection<CustomersState> = {
  name: 'customers',
  version: 1,

  init(): CustomersState {
    return {
      customers: {},
      balances: {},
      transactions: {},
      creditSales: {},
      heldCreditVoids: {},
    };
  },

  apply(state: CustomersState, event: NdekoEvent): CustomersState {
    switch (event.type) {
      case 'CUSTOMER_UPSERTED': {
        const p = event.payload as CustomerUpsertedV1;
        const current = state.customers[p.customerId] ?? {};

        const name = applyFieldLww(current.name, current.nameHlc, p.name, event.hlc);
        const phone = applyFieldLww(current.phone, current.phoneHlc, p.phone, event.hlc);
        const creditLimit = applyFieldLww(
          current.creditLimitKobo,
          current.creditLimitHlc,
          p.creditLimitKobo,
          event.hlc,
        );
        const archived = applyFieldLww(
          current.archived,
          current.archivedHlc,
          p.archived,
          event.hlc,
        );

        const updatedRecord: CustomerRecord = {
          name: name.val,
          nameHlc: name.hlc,
          phone: phone.val,
          phoneHlc: phone.hlc,
          creditLimitKobo: creditLimit.val,
          creditLimitHlc: creditLimit.hlc,
          archived: archived.val,
          archivedHlc: archived.hlc,
        };

        return {
          ...state,
          customers: {
            ...state.customers,
            [p.customerId]: updatedRecord,
          },
        };
      }

      case 'SALE_RECORDED': {
        const p = event.payload as SaleRecordedV1;
        if (!p.customerId) return state;

        // Sum credit tenders
        let creditAmount = 0;
        for (const t of p.tenders) {
          if (t.method === 'CREDIT') {
            creditAmount += t.amountKobo;
          }
        }
        if (creditAmount <= 0) return state;

        const customerId = p.customerId;
        const nextCreditSales = {
          ...state.creditSales,
          [p.saleId]: { customerId, creditKobo: creditAmount },
        };

        // If a void was already held for this sale: void takes effect immediately
        if (state.heldCreditVoids[p.saleId]) {
          const heldVoidEvent = state.heldCreditVoids[p.saleId]!;
          const voidPayload = heldVoidEvent.payload as SaleVoidedV1;
          const nextHeld = { ...state.heldCreditVoids };
          delete nextHeld[p.saleId];

          const currentBal = state.balances[customerId] ?? 0;
          const currentTxns = state.transactions[customerId] ?? {};

          const saleTxn: CustomerTransaction = {
            id: event.id,
            type: 'CREDIT_SALE',
            hlc: event.hlc,
            amountKobo: creditAmount,
            refId: p.saleId,
            note: `Receipt #${p.receiptNo}`,
            createdAt: event.createdAt,
          };

          const voidTxn: CustomerTransaction = {
            id: heldVoidEvent.id,
            type: 'VOID',
            hlc: heldVoidEvent.hlc,
            amountKobo: -creditAmount,
            refId: p.saleId,
            note: `Void: ${voidPayload.reason}`,
            createdAt: heldVoidEvent.createdAt,
          };

          return {
            ...state,
            creditSales: nextCreditSales,
            heldCreditVoids: nextHeld,
            balances: {
              ...state.balances,
              [customerId]: currentBal,
            },
            transactions: {
              ...state.transactions,
              [customerId]: {
                ...currentTxns,
                [saleTxn.id]: saleTxn,
                [voidTxn.id]: voidTxn,
              },
            },
          };
        }

        // Add to customer balance and ledger
        const currentBal = state.balances[customerId] ?? 0;
        const currentTxns = state.transactions[customerId] ?? {};

        const newTxn: CustomerTransaction = {
          id: event.id,
          type: 'CREDIT_SALE',
          hlc: event.hlc,
          amountKobo: creditAmount,
          refId: p.saleId,
          note: `Receipt #${p.receiptNo}`,
          createdAt: event.createdAt,
        };

        return {
          ...state,
          creditSales: nextCreditSales,
          balances: {
            ...state.balances,
            [customerId]: currentBal + creditAmount,
          },
          transactions: {
            ...state.transactions,
            [customerId]: {
              ...currentTxns,
              [newTxn.id]: newTxn,
            },
          },
        };
      }

      case 'SALE_VOIDED': {
        const p = event.payload as SaleVoidedV1;
        const recorded = state.creditSales[p.saleId];

        // Out-of-order replication: void arrived before credit sale
        if (!recorded) {
          return {
            ...state,
            heldCreditVoids: {
              ...state.heldCreditVoids,
              [p.saleId]: event as NdekoEvent<SaleVoidedV1>,
            },
          };
        }

        // Reconcile: reduce balance and add void transaction
        const customerId = recorded.customerId;
        const currentBal = state.balances[customerId] ?? 0;
        const currentTxns = state.transactions[customerId] ?? {};

        const voidTxn: CustomerTransaction = {
          id: event.id,
          type: 'VOID',
          hlc: event.hlc,
          amountKobo: -recorded.creditKobo,
          refId: p.saleId,
          note: `Void: ${p.reason}`,
          createdAt: event.createdAt,
        };

        return {
          ...state,
          balances: {
            ...state.balances,
            [customerId]: currentBal - recorded.creditKobo,
          },
          transactions: {
            ...state.transactions,
            [customerId]: {
              ...currentTxns,
              [voidTxn.id]: voidTxn,
            },
          },
        };
      }

      case 'PAYMENT_RECEIVED': {
        const p = event.payload as PaymentReceivedV1;
        const customerId = p.customerId;
        const currentBal = state.balances[customerId] ?? 0;
        const currentTxns = state.transactions[customerId] ?? {};

        const paymentTxn: CustomerTransaction = {
          id: event.id,
          type: 'PAYMENT',
          hlc: event.hlc,
          amountKobo: -p.amountKobo,
          refId: p.paymentId,
          note: p.note ? `${p.method}: ${p.note}` : `${p.method} Payment`,
          createdAt: event.createdAt,
        };

        return {
          ...state,
          balances: {
            ...state.balances,
            [customerId]: currentBal - p.amountKobo,
          },
          transactions: {
            ...state.transactions,
            [customerId]: {
              ...currentTxns,
              [paymentTxn.id]: paymentTxn,
            },
          },
        };
      }

      default:
        return state;
    }
  },
};

/**
 * Resolved customer view with running balance and credit status.
 */
export function customerView(state: CustomersState, customerId: string): CustomerView | undefined {
  const record = state.customers[customerId];
  const balanceKobo = state.balances[customerId] ?? 0;
  if (!record && balanceKobo === 0) return undefined;

  const creditLimitKobo = record?.creditLimitKobo ?? 0;
  const availableCreditKobo = Math.max(0, creditLimitKobo - balanceKobo);
  const isOverLimit = creditLimitKobo > 0 && balanceKobo > creditLimitKobo;

  return {
    id: customerId,
    name: record?.name ?? `Customer ${customerId.slice(0, 8)}`,
    phone: record?.phone ?? '',
    creditLimitKobo,
    balanceKobo,
    availableCreditKobo,
    isOverLimit,
    archived: record?.archived ?? false,
  };
}

/**
 * Detailed chronological transaction statement for a customer.
 */
export function customerStatement(
  state: CustomersState,
  customerId: string,
): CustomerTransaction[] {
  const txnsMap = state.transactions[customerId] ?? {};
  return Object.values(txnsMap).sort((a, b) => compareHlc(a.hlc, b.hlc));
}
