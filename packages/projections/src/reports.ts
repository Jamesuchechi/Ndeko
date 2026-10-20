/**
 * Retail reporting, cash-up variance, margin analytics, and CSV exports.
 * Pure functions over immutable event logs and projections.
 */
import { lineTotal, type NdekoEvent } from '@ndeko/core';
import type { SaleRecordedV1, SaleVoidedV1 } from '@ndeko/schemas';
import type { ProductsState } from './products';
import { productView } from './products';
import type { StockState } from './stock';
import { stockLevel } from './stock';
import type { CustomersState } from './customers';
import { customerView } from './customers';

export interface DayCloseRecord {
  readonly businessDate: string;
  readonly expectedCashKobo: number;
  readonly countedCashKobo: number;
  readonly varianceKobo: number;
  readonly note?: string | undefined;
  readonly closedAt: number;
  readonly closedByDeviceId: string;
}

export interface DailySalesReport {
  readonly date: string;
  readonly salesCount: number;
  readonly grossRevenueKobo: number;
  readonly cogsKobo: number;
  readonly marginKobo: number;
  readonly marginPercent: number;
  readonly cashKobo: number;
  readonly transferKobo: number;
  readonly cardKobo: number;
  readonly creditKobo: number;
}

export interface ProductPerformanceReport {
  readonly productId: string;
  readonly name: string;
  readonly unitsSoldMilli: number;
  readonly revenueKobo: number;
  readonly cogsKobo: number;
  readonly marginKobo: number;
  readonly marginPercent: number;
}

export interface StockValuationItem {
  readonly productId: string;
  readonly name: string;
  readonly stockMilli: number;
  readonly unitCostKobo: number;
  readonly valuationKobo: number;
}

export interface AgedDebtorItem {
  readonly customerId: string;
  readonly name: string;
  readonly phone: string;
  readonly creditLimitKobo: number;
  readonly balanceKobo: number;
  readonly lastActivityDate: string;
}

/**
 * Computes expected cash for a specific business date from a list of events.
 */
export function calculateExpectedCashForDate(
  events: readonly NdekoEvent[],
  targetDate: string, // YYYY-MM-DD
): { expectedCashKobo: number; cashSalesCount: number } {
  // Collect voids
  const voidedSaleIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'SALE_VOIDED') {
      const p = e.payload as SaleVoidedV1;
      voidedSaleIds.add(p.saleId);
    }
  }

  let expectedCashKobo = 0;
  let cashSalesCount = 0;

  for (const e of events) {
    const eventDate = new Date(e.createdAt).toISOString().slice(0, 10);
    if (eventDate !== targetDate) continue;

    if (e.type === 'SALE_RECORDED') {
      const p = e.payload as SaleRecordedV1;
      if (voidedSaleIds.has(p.saleId)) continue;

      let hasCash = false;
      for (const t of p.tenders) {
        if (t.method === 'CASH') {
          expectedCashKobo += t.amountKobo;
          hasCash = true;
        }
      }
      if (hasCash) cashSalesCount++;
    } else if (e.type === 'PAYMENT_RECEIVED') {
      const p = e.payload as { method: string; amountKobo: number };
      if (p.method === 'CASH') {
        expectedCashKobo += p.amountKobo;
      }
    }
  }

  return { expectedCashKobo, cashSalesCount };
}

export function calculateExpectedCashKobo(
  events: readonly NdekoEvent[],
  targetDate: string,
  _branchId?: string,
): number {
  return calculateExpectedCashForDate(events, targetDate).expectedCashKobo;
}

/**
 * Aggregates daily sales, tenders, cost of goods, and margins.
 */
export function generateDailySalesReport(
  events: readonly NdekoEvent[],
  productsState: ProductsState,
): DailySalesReport[] {
  const voidedSaleIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'SALE_VOIDED') {
      voidedSaleIds.add((e.payload as SaleVoidedV1).saleId);
    }
  }

  const byDate = new Map<
    string,
    {
      salesCount: number;
      revenueKobo: number;
      cogsKobo: number;
      cashKobo: number;
      transferKobo: number;
      cardKobo: number;
      creditKobo: number;
    }
  >();

  for (const e of events) {
    if (e.type !== 'SALE_RECORDED') continue;
    const p = e.payload as SaleRecordedV1;
    if (voidedSaleIds.has(p.saleId)) continue;

    const dateStr = new Date(e.createdAt).toISOString().slice(0, 10);
    let day = byDate.get(dateStr);
    if (!day) {
      day = {
        salesCount: 0,
        revenueKobo: 0,
        cogsKobo: 0,
        cashKobo: 0,
        transferKobo: 0,
        cardKobo: 0,
        creditKobo: 0,
      };
      byDate.set(dateStr, day);
    }

    day.salesCount++;
    day.revenueKobo += p.totalKobo;

    // Tenders
    for (const t of p.tenders) {
      if (t.method === 'CASH') day.cashKobo += t.amountKobo;
      else if (t.method === 'TRANSFER') day.transferKobo += t.amountKobo;
      else if (t.method === 'CARD') day.cardKobo += t.amountKobo;
      else if (t.method === 'CREDIT') day.creditKobo += t.amountKobo;
    }

    // COGS
    for (const line of p.lines) {
      const prod = productView(productsState, line.productId);
      const costKobo = prod?.costKobo ?? 0;
      const lineCogs = lineTotal(costKobo, line.qty);
      day.cogsKobo += lineCogs;
    }
  }

  const reports: DailySalesReport[] = [];
  for (const [date, data] of byDate.entries()) {
    const marginKobo = data.revenueKobo - data.cogsKobo;
    const marginPercent =
      data.revenueKobo > 0 ? Math.round((marginKobo / data.revenueKobo) * 1000) / 10 : 0;

    reports.push({
      date,
      salesCount: data.salesCount,
      grossRevenueKobo: data.revenueKobo,
      cogsKobo: data.cogsKobo,
      marginKobo,
      marginPercent,
      cashKobo: data.cashKobo,
      transferKobo: data.transferKobo,
      cardKobo: data.cardKobo,
      creditKobo: data.creditKobo,
    });
  }

  return reports.sort((a, b) => b.date.localeCompare(a.date));
}

export function buildDailySalesReport(events: readonly NdekoEvent[]): {
  date: string;
  grossSalesKobo: number;
  voidsKobo: number;
  netSalesKobo: number;
  cashKobo: number;
  transferKobo: number;
  cardKobo: number;
  creditKobo: number;
  transactionCount: number;
}[] {
  const voidedMap = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'SALE_VOIDED') {
      const p = e.payload as SaleVoidedV1;
      voidedMap.set(p.saleId, 0);
    }
  }

  for (const e of events) {
    if (e.type === 'SALE_RECORDED') {
      const p = e.payload as SaleRecordedV1;
      if (voidedMap.has(p.saleId)) {
        voidedMap.set(p.saleId, p.totalKobo);
      }
    }
  }

  const byDate = new Map<
    string,
    {
      grossSalesKobo: number;
      voidsKobo: number;
      cashKobo: number;
      transferKobo: number;
      cardKobo: number;
      creditKobo: number;
      transactionCount: number;
    }
  >();

  for (const e of events) {
    if (e.type === 'SALE_RECORDED') {
      const p = e.payload as SaleRecordedV1;
      const date = new Date(e.createdAt).toISOString().slice(0, 10);
      let day = byDate.get(date);
      if (!day) {
        day = {
          grossSalesKobo: 0,
          voidsKobo: 0,
          cashKobo: 0,
          transferKobo: 0,
          cardKobo: 0,
          creditKobo: 0,
          transactionCount: 0,
        };
        byDate.set(date, day);
      }

      day.grossSalesKobo += p.totalKobo;
      day.transactionCount++;
      if (voidedMap.has(p.saleId)) {
        day.voidsKobo += p.totalKobo;
      }

      for (const t of p.tenders) {
        if (t.method === 'CASH') day.cashKobo += t.amountKobo;
        else if (t.method === 'TRANSFER') day.transferKobo += t.amountKobo;
        else if (t.method === 'CARD') day.cardKobo += t.amountKobo;
        else if (t.method === 'CREDIT') day.creditKobo += t.amountKobo;
      }
    }
  }

  const result = [];
  for (const [date, d] of byDate.entries()) {
    result.push({
      date,
      grossSalesKobo: d.grossSalesKobo,
      voidsKobo: d.voidsKobo,
      netSalesKobo: d.grossSalesKobo - d.voidsKobo,
      cashKobo: d.cashKobo,
      transferKobo: d.transferKobo,
      cardKobo: d.cardKobo,
      creditKobo: d.creditKobo,
      transactionCount: d.transactionCount,
    });
  }

  return result.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Aggregates product sales and profitability margins.
 */
export function generateProductPerformanceReport(
  events: readonly NdekoEvent[],
  productsState: ProductsState,
): ProductPerformanceReport[] {
  const voidedSaleIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'SALE_VOIDED') {
      voidedSaleIds.add((e.payload as SaleVoidedV1).saleId);
    }
  }

  const byProduct = new Map<
    string,
    {
      unitsSoldMilli: number;
      revenueKobo: number;
      cogsKobo: number;
    }
  >();

  for (const e of events) {
    if (e.type !== 'SALE_RECORDED') continue;
    const p = e.payload as SaleRecordedV1;
    if (voidedSaleIds.has(p.saleId)) continue;

    for (const line of p.lines) {
      let item = byProduct.get(line.productId);
      if (!item) {
        item = { unitsSoldMilli: 0, revenueKobo: 0, cogsKobo: 0 };
        byProduct.set(line.productId, item);
      }

      item.unitsSoldMilli += line.qty;
      item.revenueKobo += line.lineTotalKobo;

      const prod = productView(productsState, line.productId);
      const costKobo = prod?.costKobo ?? 0;
      item.cogsKobo += lineTotal(costKobo, line.qty);
    }
  }

  const reports: ProductPerformanceReport[] = [];
  for (const [productId, data] of byProduct.entries()) {
    const prod = productView(productsState, productId);
    const marginKobo = data.revenueKobo - data.cogsKobo;
    const marginPercent =
      data.revenueKobo > 0 ? Math.round((marginKobo / data.revenueKobo) * 1000) / 10 : 0;

    reports.push({
      productId,
      name: prod?.name ?? `Item ${productId.slice(0, 8)}`,
      unitsSoldMilli: data.unitsSoldMilli,
      revenueKobo: data.revenueKobo,
      cogsKobo: data.cogsKobo,
      marginKobo,
      marginPercent,
    });
  }

  return reports.sort((a, b) => b.revenueKobo - a.revenueKobo);
}

export function buildProductPerformanceReport(
  events: readonly NdekoEvent[],
  productsState: ProductsState,
  stockState: StockState,
  branchId: string,
): {
  productId: string;
  name: string;
  unitsSold: number;
  revenueKobo: number;
  cogsKobo: number;
  marginKobo: number;
  marginPct: number;
  currentStockUnits: number;
}[] {
  const base = generateProductPerformanceReport(events, productsState);
  return base.map((p) => {
    const curStockMilli = stockLevel(stockState, branchId, p.productId);
    return {
      productId: p.productId,
      name: p.name,
      unitsSold: p.unitsSoldMilli / 1000,
      revenueKobo: p.revenueKobo,
      cogsKobo: p.cogsKobo,
      marginKobo: p.marginKobo,
      marginPct: p.marginPercent,
      currentStockUnits: curStockMilli / 1000,
    };
  });
}

/**
 * Computes current inventory valuation.
 */
export function generateStockValuationReport(
  stockState: StockState,
  productsState: ProductsState,
  branchId: string,
): { items: StockValuationItem[]; totalValuationKobo: number } {
  const items: StockValuationItem[] = [];
  let totalValuationKobo = 0;

  for (const productId of Object.keys(productsState.products)) {
    const prod = productView(productsState, productId);
    if (!prod || prod.archived) continue;

    const stockMilli = stockLevel(stockState, branchId, productId);
    if (stockMilli <= 0) continue;

    const unitCostKobo = prod.costKobo ?? 0;
    const valuationKobo = lineTotal(unitCostKobo, stockMilli);
    totalValuationKobo += valuationKobo;

    items.push({
      productId,
      name: prod.name ?? '',
      stockMilli,
      unitCostKobo,
      valuationKobo,
    });
  }

  items.sort((a, b) => b.valuationKobo - a.valuationKobo);
  return { items, totalValuationKobo };
}

export function buildStockValuationReport(
  productsState: ProductsState,
  stockState: StockState,
  branchId: string,
): {
  totalCostKobo: number;
  totalRetailKobo: number;
  potentialProfitKobo: number;
  items: {
    productId: string;
    name: string;
    stockUnits: number;
    unitCostKobo: number;
    unitPriceKobo: number;
    totalCostKobo: number;
    totalRetailKobo: number;
    potentialProfitKobo: number;
  }[];
} {
  const items = [];
  let totalCostKobo = 0;
  let totalRetailKobo = 0;

  for (const productId of Object.keys(productsState.products)) {
    const prod = productView(productsState, productId);
    if (!prod || prod.archived) continue;
    const stockMilli = stockLevel(stockState, branchId, productId);
    if (stockMilli <= 0) continue;

    const stockUnits = stockMilli / 1000;
    const unitCostKobo = prod.costKobo ?? 0;
    const unitPriceKobo = prod.priceKobo ?? 0;
    const itemCostKobo = lineTotal(unitCostKobo, stockMilli);
    const itemRetailKobo = lineTotal(unitPriceKobo, stockMilli);
    const potentialProfitKobo = itemRetailKobo - itemCostKobo;

    totalCostKobo += itemCostKobo;
    totalRetailKobo += itemRetailKobo;

    items.push({
      productId,
      name: prod.name ?? '',
      stockUnits,
      unitCostKobo,
      unitPriceKobo,
      totalCostKobo: itemCostKobo,
      totalRetailKobo: itemRetailKobo,
      potentialProfitKobo,
    });
  }

  items.sort((a, b) => b.totalRetailKobo - a.totalRetailKobo);
  return {
    totalCostKobo,
    totalRetailKobo,
    potentialProfitKobo: totalRetailKobo - totalCostKobo,
    items,
  };
}

/**
 * Returns customers with outstanding debt.
 */
export function generateAgedDebtorsReport(customersState: CustomersState): AgedDebtorItem[] {
  const items: AgedDebtorItem[] = [];

  for (const [customerId, balanceKobo] of Object.entries(customersState.balances)) {
    if (balanceKobo <= 0) continue;
    const view = customerView(customersState, customerId);
    if (!view) continue;

    const txnsMap = customersState.transactions[customerId] ?? {};
    const txns = Object.values(txnsMap).sort((a, b) => a.createdAt - b.createdAt);
    const lastTxn = txns[txns.length - 1];
    const lastActivityDate = lastTxn
      ? new Date(lastTxn.createdAt).toISOString().slice(0, 10)
      : 'N/A';

    items.push({
      customerId,
      name: view.name,
      phone: view.phone,
      creditLimitKobo: view.creditLimitKobo,
      balanceKobo,
      lastActivityDate,
    });
  }

  return items.sort((a, b) => b.balanceKobo - a.balanceKobo);
}

export function buildAgedDebtorsReport(
  customersState: CustomersState,
  asOfDate: string,
): {
  totalOutstandingKobo: number;
  bucketTotals: {
    current: number;
    days1_30: number;
    days31_60: number;
    days61_90: number;
    over90: number;
  };
  customers: {
    customerId: string;
    name: string;
    phone: string;
    creditLimitKobo: number;
    totalBalanceKobo: number;
    buckets: {
      current: number;
      days1_30: number;
      days31_60: number;
      days61_90: number;
      over90: number;
    };
  }[];
} {
  const asOfTime = new Date(asOfDate).getTime();
  let totalOutstandingKobo = 0;
  const bucketTotals = {
    current: 0,
    days1_30: 0,
    days31_60: 0,
    days61_90: 0,
    over90: 0,
  };

  const customersList = [];

  for (const [customerId, balanceKobo] of Object.entries(customersState.balances)) {
    if (balanceKobo <= 0) continue;
    const view = customerView(customersState, customerId);
    if (!view) continue;

    totalOutstandingKobo += balanceKobo;

    const txnsMap = customersState.transactions[customerId] ?? {};
    const txns = Object.values(txnsMap).sort((a, b) => a.createdAt - b.createdAt);
    const lastTxn = txns[txns.length - 1];
    const ageDays = lastTxn
      ? Math.max(0, Math.floor((asOfTime - lastTxn.createdAt) / 86400000))
      : 0;

    const buckets = {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      over90: 0,
    };

    if (ageDays === 0) buckets.current = balanceKobo;
    else if (ageDays <= 30) buckets.days1_30 = balanceKobo;
    else if (ageDays <= 60) buckets.days31_60 = balanceKobo;
    else if (ageDays <= 90) buckets.days61_90 = balanceKobo;
    else buckets.over90 = balanceKobo;

    bucketTotals.current += buckets.current;
    bucketTotals.days1_30 += buckets.days1_30;
    bucketTotals.days31_60 += buckets.days31_60;
    bucketTotals.days61_90 += buckets.days61_90;
    bucketTotals.over90 += buckets.over90;

    customersList.push({
      customerId,
      name: view.name,
      phone: view.phone,
      creditLimitKobo: view.creditLimitKobo,
      totalBalanceKobo: balanceKobo,
      buckets,
    });
  }

  customersList.sort((a, b) => b.totalBalanceKobo - a.totalBalanceKobo);
  return {
    totalOutstandingKobo,
    bucketTotals,
    customers: customersList,
  };
}

export type CsvColumnDef<T, K extends keyof T = keyof T> = K extends keyof T
  ? {
      header: string;
      key: K;
      format?: (val: T[K]) => string;
    }
  : never;

/**
 * Converts column specification and row objects into RFC-4180 compliant CSV string.
 */
export function exportToCsv<T extends Record<string, unknown>>(
  columns: readonly CsvColumnDef<T>[],
  rows: readonly T[],
): string {
  const headerRow = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');
  const dataRows = rows.map((row) =>
    columns
      .map((col) => {
        const raw = row[col.key];
        const formatted = col.format
          ? (col.format as (val: unknown) => string)(raw)
          : String(raw ?? '');
        return `"${formatted.replace(/"/g, '""')}"`;
      })
      .join(','),
  );
  return [headerRow, ...dataRows].join('\n');
}

/**
 * Generic row-based RFC-4180 CSV serializer.
 */
export function toCsv<T extends Record<string, unknown>>(rows: readonly T[]): string {
  if (rows.length === 0) return '';
  const first = rows[0]!;
  const columns = Object.keys(first).map((key) => ({
    header: key,
    key: key as keyof T,
  })) as unknown as readonly CsvColumnDef<T>[];
  return exportToCsv(columns, rows);
}
