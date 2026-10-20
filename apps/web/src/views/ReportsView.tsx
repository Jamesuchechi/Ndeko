import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { formatNaira, type NdekoEvent } from '@ndeko/core';
import type { DayClosedV1 } from '@ndeko/schemas';
import {
  calculateExpectedCashKobo,
  buildDailySalesReport,
  buildProductPerformanceReport,
  buildStockValuationReport,
  buildAgedDebtorsReport,
  toCsv,
} from '@ndeko/projections';
import { useNdeko } from '../context/NdekoContext';

type ReportTab = 'cashup' | 'dailysales' | 'products' | 'valuation' | 'debtors';

export const ReportsView: React.FC = () => {
  const { config, productsState, stockState, customersState, getAllEvents, closeDay } = useNdeko();

  const [activeTab, setActiveTab] = useState<ReportTab>('cashup');
  const [events, setEvents] = useState<NdekoEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Cash-up form
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cashUpDate, setCashUpDate] = useState(todayStr);
  const [countedCashNaira, setCountedCashNaira] = useState('');
  const [cashUpNote, setCashUpNote] = useState('');
  const [isClosingDay, setIsClosingDay] = useState(false);
  const [cashUpSuccess, setCashUpSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      const all = await getAllEvents();
      setEvents(all);
    } finally {
      setIsLoading(false);
    }
  }, [getAllEvents]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Expected cash calculation for selected date
  const expectedCashKobo = useMemo(() => {
    return calculateExpectedCashKobo(events, cashUpDate, config.branchId);
  }, [events, cashUpDate, config.branchId]);

  const countedCashKobo = useMemo(() => {
    if (!countedCashNaira.trim()) return null;
    const n = parseFloat(countedCashNaira);
    return isNaN(n) ? null : Math.round(n * 100);
  }, [countedCashNaira]);

  const cashVarianceKobo = useMemo(() => {
    if (countedCashKobo === null) return null;
    return countedCashKobo - expectedCashKobo;
  }, [countedCashKobo, expectedCashKobo]);

  // Closed days history
  const closedDays = useMemo(() => {
    return events
      .filter((e) => e.type === 'DAY_CLOSED')
      .map((e) => ({
        event: e as NdekoEvent<DayClosedV1>,
        payload: e.payload as DayClosedV1,
      }))
      .reverse();
  }, [events]);

  // Reports data
  const dailySalesReport = useMemo(() => {
    return buildDailySalesReport(events);
  }, [events]);

  const productPerformanceReport = useMemo(() => {
    return buildProductPerformanceReport(events, productsState, stockState, config.branchId);
  }, [events, productsState, stockState, config.branchId]);

  const stockValuationReport = useMemo(() => {
    return buildStockValuationReport(productsState, stockState, config.branchId);
  }, [productsState, stockState, config.branchId]);

  const agedDebtorsReport = useMemo(() => {
    return buildAgedDebtorsReport(customersState, todayStr);
  }, [customersState, todayStr]);

  // CSV download helper
  const triggerCsvDownload = (rows: Record<string, unknown>[], filename: string) => {
    const csvStr = toCsv(rows);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${todayStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCommitCashUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (countedCashKobo === null) {
      setErrorMsg('Please enter physical cash counted.');
      return;
    }
    setIsClosingDay(true);
    setErrorMsg(null);
    setCashUpSuccess(null);

    try {
      await closeDay(cashUpDate, expectedCashKobo, countedCashKobo, cashUpNote.trim() || undefined);
      setCashUpSuccess(`Day ${cashUpDate} closed successfully.`);
      setCountedCashNaira('');
      setCashUpNote('');
      await fetchEvents();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error committing day close');
    } finally {
      setIsClosingDay(false);
    }
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerSectionStyle}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Retail Intelligence & Reports</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Auditable sales summaries, product margins, inventory valuation, and end-of-day cash-up.
          </p>
        </div>
        <button onClick={fetchEvents} className="btn-secondary" style={refreshBtnStyle}>
          🔄 Refresh
        </button>
      </div>

      {/* Tabs */}
      <div style={tabNavStyle}>
        <button
          onClick={() => setActiveTab('cashup')}
          style={{ ...tabBtnStyle, ...(activeTab === 'cashup' ? activeTabBtnStyle : {}) }}
        >
          🔒 Cash-Up (DAY_CLOSED)
        </button>
        <button
          onClick={() => setActiveTab('dailysales')}
          style={{ ...tabBtnStyle, ...(activeTab === 'dailysales' ? activeTabBtnStyle : {}) }}
        >
          📅 Daily Sales
        </button>
        <button
          onClick={() => setActiveTab('products')}
          style={{ ...tabBtnStyle, ...(activeTab === 'products' ? activeTabBtnStyle : {}) }}
        >
          🏷️ Margins & Volumes
        </button>
        <button
          onClick={() => setActiveTab('valuation')}
          style={{ ...tabBtnStyle, ...(activeTab === 'valuation' ? activeTabBtnStyle : {}) }}
        >
          📦 Stock Valuation
        </button>
        <button
          onClick={() => setActiveTab('debtors')}
          style={{ ...tabBtnStyle, ...(activeTab === 'debtors' ? activeTabBtnStyle : {}) }}
        >
          ⏳ Aged Debtors
        </button>
      </div>

      {isLoading && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          Computing projections from event log...
        </div>
      )}

      {!isLoading && (
        <>
          {/* TAB 1: END OF DAY CASH-UP */}
          {activeTab === 'cashup' && (
            <div
              style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 24 }}
            >
              {/* Form Card */}
              <div style={cardStyle} className="glass-panel">
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 14 }}>
                  End-of-Day Register Cash-Up
                </h3>

                {cashUpSuccess && <div style={successBannerStyle}>✓ {cashUpSuccess}</div>}
                {errorMsg && <div style={errorBannerStyle}>⚠️ {errorMsg}</div>}

                <form onSubmit={handleCommitCashUp}>
                  <div style={formGroupStyle}>
                    <label style={labelStyle}>Business Trading Date</label>
                    <input
                      type="date"
                      value={cashUpDate}
                      onChange={(e) => setCashUpDate(e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <div style={expectedCashCardStyle}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Expected Register Cash:
                    </span>
                    <strong style={{ fontSize: '1.4rem', color: 'var(--accent-emerald)' }}>
                      {formatNaira(expectedCashKobo)}
                    </strong>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                      Calculated from cash sales and cash customer repayments
                    </span>
                  </div>

                  <div style={formGroupStyle}>
                    <label style={labelStyle}>Counted Physical Cash (₦ Naira) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      placeholder="e.g. 84500"
                      value={countedCashNaira}
                      onChange={(e) => setCountedCashNaira(e.target.value)}
                      style={{ ...inputStyle, fontSize: '1.1rem', fontWeight: 700 }}
                    />
                  </div>

                  {cashVarianceKobo !== null && (
                    <div
                      style={{
                        ...varianceCardStyle,
                        background:
                          cashVarianceKobo === 0
                            ? 'rgba(16, 185, 129, 0.15)'
                            : cashVarianceKobo > 0
                              ? 'rgba(6, 182, 212, 0.15)'
                              : 'rgba(244, 63, 94, 0.15)',
                        borderColor:
                          cashVarianceKobo === 0
                            ? 'var(--accent-emerald)'
                            : cashVarianceKobo > 0
                              ? 'var(--accent-cyan)'
                              : 'var(--accent-rose)',
                      }}
                    >
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Cash Variance:
                      </span>
                      <strong
                        style={{
                          fontSize: '1.2rem',
                          color:
                            cashVarianceKobo === 0
                              ? 'var(--accent-emerald)'
                              : cashVarianceKobo > 0
                                ? 'var(--accent-cyan)'
                                : '#f43f5e',
                        }}
                      >
                        {cashVarianceKobo === 0
                          ? 'Exact Match (₦0.00)'
                          : cashVarianceKobo > 0
                            ? `+${formatNaira(cashVarianceKobo)} (Surplus)`
                            : `${formatNaira(cashVarianceKobo)} (Shortage)`}
                      </strong>
                    </div>
                  )}

                  <div style={formGroupStyle}>
                    <label style={labelStyle}>Reconciliation Note (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Petty cash adjustment or teller initials"
                      value={cashUpNote}
                      onChange={(e) => setCashUpNote(e.target.value)}
                      style={inputStyle}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isClosingDay || countedCashKobo === null}
                    className="glow-btn"
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: 'var(--radius-sm)',
                      marginTop: 10,
                    }}
                  >
                    {isClosingDay ? 'Closing Day...' : 'Commit End-of-Day Close'}
                  </button>
                </form>
              </div>

              {/* Day Close History */}
              <div style={cardStyle} className="glass-panel">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Closed Days Log</h3>
                  {closedDays.length > 0 && (
                    <button
                      onClick={() =>
                        triggerCsvDownload(
                          closedDays.map((c) => ({
                            'Business Date': c.payload.businessDate,
                            'Expected Cash (Kobo)': c.payload.expectedCashKobo,
                            'Counted Cash (Kobo)': c.payload.countedCashKobo,
                            'Variance (Kobo)':
                              c.payload.countedCashKobo - c.payload.expectedCashKobo,
                            Note: c.payload.note || '',
                            'Closed At': new Date(c.event.createdAt).toLocaleString('en-NG'),
                          })),
                          'day_closed_log',
                        )
                      }
                      className="btn-secondary"
                      style={smallBtnStyle}
                    >
                      📥 Export CSV
                    </button>
                  )}
                </div>

                <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={tableHeadRowStyle}>
                        <th style={thStyle}>Date</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Expected</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Counted</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Variance</th>
                        <th style={thStyle}>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closedDays.map((c) => {
                        const variance = c.payload.countedCashKobo - c.payload.expectedCashKobo;
                        return (
                          <tr key={c.event.id} style={tableRowStyle}>
                            <td style={{ ...tdStyle, fontWeight: 700 }}>
                              {c.payload.businessDate}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                              {formatNaira(c.payload.expectedCashKobo)}
                            </td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                              {formatNaira(c.payload.countedCashKobo)}
                            </td>
                            <td
                              style={{
                                ...tdStyle,
                                textAlign: 'right',
                                fontWeight: 800,
                                color:
                                  variance === 0
                                    ? 'var(--accent-emerald)'
                                    : variance > 0
                                      ? 'var(--accent-cyan)'
                                      : '#f43f5e',
                              }}
                            >
                              {variance === 0
                                ? '₦0.00'
                                : variance > 0
                                  ? `+${formatNaira(variance)}`
                                  : formatNaira(variance)}
                            </td>
                            <td
                              style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.8rem' }}
                            >
                              {c.payload.note || '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {closedDays.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            style={{
                              textAlign: 'center',
                              padding: '30px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            No days closed yet. Use the form on the left to close today's register.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DAILY SALES */}
          {activeTab === 'dailysales' && (
            <div style={cardStyle} className="glass-panel">
              <div style={reportHeaderStyle}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Daily Sales Summary</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Gross revenue, returns, net sales, and payment method distribution.
                  </p>
                </div>
                <button
                  onClick={() =>
                    triggerCsvDownload(
                      dailySalesReport.map((r) => ({
                        Date: r.date,
                        'Gross Sales (Kobo)': r.grossSalesKobo,
                        'Voids / Refunds (Kobo)': r.voidsKobo,
                        'Net Sales (Kobo)': r.netSalesKobo,
                        'Cash (Kobo)': r.cashKobo,
                        'Transfer (Kobo)': r.transferKobo,
                        'Card (Kobo)': r.cardKobo,
                        'Credit (Kobo)': r.creditKobo,
                        Transactions: r.transactionCount,
                      })),
                      'daily_sales_report',
                    )
                  }
                  className="btn-secondary"
                  style={smallBtnStyle}
                >
                  📥 Export CSV
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={tableHeadRowStyle}>
                      <th style={thStyle}>Date</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Transactions</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Gross Sales</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Voids</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Net Sales</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Cash</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Transfer</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Card</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailySalesReport.map((r) => (
                      <tr key={r.date} style={tableRowStyle}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{r.date}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}>
                          {r.transactionCount}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {formatNaira(r.grossSalesKobo)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            color: r.voidsKobo > 0 ? '#f43f5e' : 'inherit',
                          }}
                        >
                          {r.voidsKobo > 0 ? `-${formatNaira(r.voidsKobo)}` : '₦0.00'}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            fontWeight: 800,
                            color: 'var(--accent-emerald)',
                          }}
                        >
                          {formatNaira(r.netSalesKobo)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {formatNaira(r.cashKobo)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {formatNaira(r.transferKobo)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          {formatNaira(r.cardKobo)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            color: r.creditKobo > 0 ? '#f59e0b' : 'inherit',
                          }}
                        >
                          {formatNaira(r.creditKobo)}
                        </td>
                      </tr>
                    ))}
                    {dailySalesReport.length === 0 && (
                      <tr>
                        <td
                          colSpan={9}
                          style={{
                            textAlign: 'center',
                            padding: '30px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          No sales recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: PRODUCT PERFORMANCE & MARGINS */}
          {activeTab === 'products' && (
            <div style={cardStyle} className="glass-panel">
              <div style={reportHeaderStyle}>
                <div>
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                    Product Performance & Gross Margins
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Sales volume, revenue generated, estimated cost of goods, and margin
                    percentages.
                  </p>
                </div>
                <button
                  onClick={() =>
                    triggerCsvDownload(
                      productPerformanceReport.map((p) => ({
                        'Product ID': p.productId,
                        'Product Name': p.name,
                        'Units Sold': p.unitsSold,
                        'Revenue (Kobo)': p.revenueKobo,
                        'COGS (Kobo)': p.cogsKobo,
                        'Gross Margin (Kobo)': p.marginKobo,
                        'Margin (%)': p.marginPct.toFixed(1),
                        'Current Stock Units': p.currentStockUnits,
                      })),
                      'product_margins_report',
                    )
                  }
                  className="btn-secondary"
                  style={smallBtnStyle}
                >
                  📥 Export CSV
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr style={tableHeadRowStyle}>
                      <th style={thStyle}>Product</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Units Sold</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Revenue</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Est. Cost (COGS)</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Gross Margin (₦)</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Margin %</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>Stock Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productPerformanceReport.map((p) => (
                      <tr key={p.productId} style={tableRowStyle}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>{p.name}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                          {p.unitsSold}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                          {formatNaira(p.revenueKobo)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}>
                          {formatNaira(p.cogsKobo)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            fontWeight: 800,
                            color: 'var(--accent-emerald)',
                          }}
                        >
                          {formatNaira(p.marginKobo)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                          <span
                            className={`badge ${p.marginPct > 15 ? 'badge-emerald' : 'badge-amber'}`}
                          >
                            {p.marginPct.toFixed(1)}%
                          </span>
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: 'right',
                            color: p.currentStockUnits <= 5 ? '#f59e0b' : 'inherit',
                          }}
                        >
                          {p.currentStockUnits}
                        </td>
                      </tr>
                    ))}
                    {productPerformanceReport.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          style={{
                            textAlign: 'center',
                            padding: '30px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          No product sales recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: STOCK VALUATION */}
          {activeTab === 'valuation' && (
            <div>
              {/* Valuation KPI Cards */}
              <div style={kpiGridStyle}>
                <div style={kpiCardStyle} className="glass-panel">
                  <span style={kpiLabelStyle}>Total Retail Value</span>
                  <div style={{ ...kpiValueStyle, color: 'var(--accent-cyan)' }}>
                    {formatNaira(stockValuationReport.totalRetailKobo)}
                  </div>
                  <span style={kpiSubtextStyle}>Potential turnover at current selling prices</span>
                </div>

                <div style={kpiCardStyle} className="glass-panel">
                  <span style={kpiLabelStyle}>Total Cost Value</span>
                  <div style={kpiValueStyle}>{formatNaira(stockValuationReport.totalCostKobo)}</div>
                  <span style={kpiSubtextStyle}>Capital invested in inventory on hand</span>
                </div>

                <div style={kpiCardStyle} className="glass-panel">
                  <span style={kpiLabelStyle}>Potential Gross Profit</span>
                  <div style={{ ...kpiValueStyle, color: 'var(--accent-emerald)' }}>
                    {formatNaira(stockValuationReport.potentialProfitKobo)}
                  </div>
                  <span style={kpiSubtextStyle}>Gross gain upon complete inventory sale</span>
                </div>
              </div>

              <div style={cardStyle} className="glass-panel">
                <div style={reportHeaderStyle}>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                      Inventory Valuation Breakdown
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Itemized stock quantities, cost bases, retail values, and potential gains.
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      triggerCsvDownload(
                        stockValuationReport.items.map((i) => ({
                          'Product ID': i.productId,
                          'Product Name': i.name,
                          'Current Stock Units': i.stockUnits,
                          'Unit Cost (Kobo)': i.unitCostKobo,
                          'Unit Price (Kobo)': i.unitPriceKobo,
                          'Total Cost (Kobo)': i.totalCostKobo,
                          'Total Retail (Kobo)': i.totalRetailKobo,
                          'Potential Profit (Kobo)': i.potentialProfitKobo,
                        })),
                        'stock_valuation_report',
                      )
                    }
                    className="btn-secondary"
                    style={smallBtnStyle}
                  >
                    📥 Export CSV
                  </button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={tableHeadRowStyle}>
                        <th style={thStyle}>Product</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Stock on Hand</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Unit Cost</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Retail Price</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Total Cost Value</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Total Retail Value</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Potential Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stockValuationReport.items.map((i) => (
                        <tr key={i.productId} style={tableRowStyle}>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{i.name}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                            {i.stockUnits}
                          </td>
                          <td
                            style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}
                          >
                            {formatNaira(i.unitCostKobo)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {formatNaira(i.unitPriceKobo)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {formatNaira(i.totalCostKobo)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>
                            {formatNaira(i.totalRetailKobo)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              fontWeight: 800,
                              color: 'var(--accent-emerald)',
                            }}
                          >
                            {formatNaira(i.potentialProfitKobo)}
                          </td>
                        </tr>
                      ))}
                      {stockValuationReport.items.length === 0 && (
                        <tr>
                          <td
                            colSpan={7}
                            style={{
                              textAlign: 'center',
                              padding: '30px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            No stock inventory items found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: AGED DEBTORS */}
          {activeTab === 'debtors' && (
            <div>
              {/* Debtors KPI Grid */}
              <div style={kpiGridStyle}>
                <div style={kpiCardStyle} className="glass-panel">
                  <span style={kpiLabelStyle}>Total Outstanding Book</span>
                  <div style={{ ...kpiValueStyle, color: '#f43f5e' }}>
                    {formatNaira(agedDebtorsReport.totalOutstandingKobo)}
                  </div>
                  <span style={kpiSubtextStyle}>Sum of all active customer credit balances</span>
                </div>

                <div style={kpiCardStyle} className="glass-panel">
                  <span style={kpiLabelStyle}>Current (0 - 30 Days)</span>
                  <div style={{ ...kpiValueStyle, color: 'var(--accent-amber)' }}>
                    {formatNaira(
                      agedDebtorsReport.bucketTotals.current +
                        agedDebtorsReport.bucketTotals.days1_30,
                    )}
                  </div>
                  <span style={kpiSubtextStyle}>Fresh receivables within normal terms</span>
                </div>

                <div style={kpiCardStyle} className="glass-panel">
                  <span style={kpiLabelStyle}>Aged & Overdue (31+ Days)</span>
                  <div style={{ ...kpiValueStyle, color: '#f43f5e' }}>
                    {formatNaira(
                      agedDebtorsReport.bucketTotals.days31_60 +
                        agedDebtorsReport.bucketTotals.days61_90 +
                        agedDebtorsReport.bucketTotals.over90,
                    )}
                  </div>
                  <span style={kpiSubtextStyle}>Overdue credit requiring prompt follow-up</span>
                </div>
              </div>

              <div style={cardStyle} className="glass-panel">
                <div style={reportHeaderStyle}>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                      Aged Debtors Aging Schedule
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Customer receivables categorized by aging delinquency brackets.
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      triggerCsvDownload(
                        agedDebtorsReport.customers.map((c) => ({
                          'Customer ID': c.customerId,
                          'Customer Name': c.name,
                          Phone: c.phone,
                          'Credit Limit (Kobo)': c.creditLimitKobo,
                          'Total Balance (Kobo)': c.totalBalanceKobo,
                          'Current 0 Days (Kobo)': c.buckets.current,
                          '1-30 Days (Kobo)': c.buckets.days1_30,
                          '31-60 Days (Kobo)': c.buckets.days31_60,
                          '61-90 Days (Kobo)': c.buckets.days61_90,
                          'Over 90 Days (Kobo)': c.buckets.over90,
                        })),
                        'aged_debtors_report',
                      )
                    }
                    className="btn-secondary"
                    style={smallBtnStyle}
                  >
                    📥 Export CSV
                  </button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={tableHeadRowStyle}>
                        <th style={thStyle}>Customer</th>
                        <th style={thStyle}>Phone</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Total Debt</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Current</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>1-30 Days</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>31-60 Days</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>61-90 Days</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>90+ Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agedDebtorsReport.customers.map((c) => (
                        <tr key={c.customerId} style={tableRowStyle}>
                          <td style={{ ...tdStyle, fontWeight: 700 }}>{c.name}</td>
                          <td
                            style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.85rem' }}
                          >
                            {c.phone || '—'}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              fontWeight: 800,
                              color: '#f43f5e',
                            }}
                          >
                            {formatNaira(c.totalBalanceKobo)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {formatNaira(c.buckets.current)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>
                            {formatNaira(c.buckets.days1_30)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              color: c.buckets.days31_60 > 0 ? '#f59e0b' : 'inherit',
                            }}
                          >
                            {formatNaira(c.buckets.days31_60)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              color: c.buckets.days61_90 > 0 ? '#f43f5e' : 'inherit',
                            }}
                          >
                            {formatNaira(c.buckets.days61_90)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: 'right',
                              fontWeight: 700,
                              color: c.buckets.over90 > 0 ? '#f43f5e' : 'inherit',
                            }}
                          >
                            {formatNaira(c.buckets.over90)}
                          </td>
                        </tr>
                      ))}
                      {agedDebtorsReport.customers.length === 0 && (
                        <tr>
                          <td
                            colSpan={8}
                            style={{
                              textAlign: 'center',
                              padding: '30px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            No outstanding customer debts found. Credit book is completely clear!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Styles
const containerStyle: React.CSSProperties = {
  maxWidth: 1200,
  margin: '0 auto',
  padding: '24px 20px',
};

const headerSectionStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 20,
};

const refreshBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.85rem',
  fontWeight: 600,
};

const tabNavStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  marginBottom: 24,
};

const tabBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.85rem',
  color: 'var(--text-muted)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const activeTabBtnStyle: React.CSSProperties = {
  background: 'rgba(16, 185, 129, 0.15)',
  borderColor: 'var(--accent-emerald)',
  color: '#ffffff',
  fontWeight: 700,
};

const cardStyle: React.CSSProperties = {
  padding: '24px',
  borderRadius: 'var(--radius-md)',
};

const reportHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
};

const smallBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.8rem',
  fontWeight: 600,
};

const formGroupStyle: React.CSSProperties = {
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.9rem',
  outline: 'none',
};

const expectedCashCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '14px 18px',
  background: 'rgba(16, 185, 129, 0.08)',
  border: '1px solid rgba(16, 185, 129, 0.25)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 16,
};

const varianceCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '12px 16px',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 16,
};

const successBannerStyle: React.CSSProperties = {
  padding: '10px 14px',
  background: 'rgba(16, 185, 129, 0.15)',
  border: '1px solid var(--accent-emerald)',
  color: 'var(--accent-emerald)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.85rem',
  marginBottom: 14,
};

const errorBannerStyle: React.CSSProperties = {
  padding: '10px 14px',
  background: 'rgba(244, 63, 94, 0.15)',
  border: '1px solid var(--accent-rose)',
  color: '#f43f5e',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.85rem',
  marginBottom: 14,
};

const kpiGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
  marginBottom: 24,
};

const kpiCardStyle: React.CSSProperties = {
  padding: '20px',
  borderRadius: 'var(--radius-md)',
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const kpiValueStyle: React.CSSProperties = {
  fontSize: '1.7rem',
  fontWeight: 800,
  margin: '6px 0',
};

const kpiSubtextStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-dim)',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
};

const tableHeadRowStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.6)',
  borderBottom: '1px solid var(--border-subtle)',
};

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontWeight: 700,
  textAlign: 'left',
};

const tableRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border-subtle)',
};

const tdStyle: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: '0.88rem',
};
