import React, { useEffect, useState, useMemo } from 'react';
import { formatNaira, type NdekoEvent } from '@ndeko/core';
import type { SaleRecordedV1 } from '@ndeko/schemas';
import { useNdeko } from '../context/NdekoContext';
import { ReceiptModal } from '../components/ReceiptModal';

export const SalesHistoryView: React.FC = () => {
  const { getAllSales, stockState, closeDay } = useNdeko();
  const [sales, setSales] = useState<NdekoEvent<SaleRecordedV1>[]>([]);
  const [selectedSale, setSelectedSale] = useState<NdekoEvent<SaleRecordedV1> | null>(null);
  const [isCloseDayModalOpen, setIsCloseDayModalOpen] = useState(false);
  const [countedCashNaira, setCountedCashNaira] = useState('');
  const [closeNote, setCloseNote] = useState('');

  const loadSales = async () => {
    const list = await getAllSales();
    setSales(list);
  };

  useEffect(() => {
    loadSales();
  }, [stockState]);

  // Today's summary computation
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const todaySummary = useMemo(() => {
    let grossKobo = 0;
    let cashKobo = 0;
    let transferKobo = 0;
    let cardKobo = 0;
    let creditKobo = 0;
    let count = 0;

    for (const e of sales) {
      const eDate = new Date(e.createdAt).toISOString().slice(0, 10);
      const isVoid = stockState.voided[e.payload.saleId] === true;
      if (eDate === todayStr && !isVoid) {
        count++;
        grossKobo += e.payload.totalKobo;
        for (const t of e.payload.tenders) {
          if (t.method === 'CASH') cashKobo += t.amountKobo;
          else if (t.method === 'TRANSFER') transferKobo += t.amountKobo;
          else if (t.method === 'CARD') cardKobo += t.amountKobo;
          else if (t.method === 'CREDIT') creditKobo += t.amountKobo;
        }
      }
    }

    return { grossKobo, cashKobo, transferKobo, cardKobo, creditKobo, count };
  }, [sales, stockState, todayStr]);

  const handleCloseDaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const countedKobo = Math.round(parseFloat(countedCashNaira || '0') * 100);
    await closeDay(todayStr, todaySummary.cashKobo, countedKobo, closeNote || undefined);
    setIsCloseDayModalOpen(false);
    setCountedCashNaira('');
    setCloseNote('');
    alert('Day closed successfully! DAY_CLOSED event recorded in local log.');
  };

  return (
    <div style={containerStyle}>
      {/* Daily Sales Summary Card */}
      <div style={summaryPanelStyle} className="glass-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.2rem' }}>📊</span>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>
                Daily Sales Summary ({todayStr})
              </h3>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Reconciled across immutable sale events
            </p>
          </div>
          <button
            onClick={() => setIsCloseDayModalOpen(true)}
            className="btn-secondary"
            style={closeDayBtnStyle}
          >
            🔒 End-of-Day Cash-Up
          </button>
        </div>

        <div style={metricsGridStyle}>
          <div style={metricItemStyle}>
            <span style={metricLabelStyle}>Gross Total</span>
            <span style={{ ...metricValueStyle, color: '#34d399' }}>
              {formatNaira(todaySummary.grossKobo)}
            </span>
          </div>
          <div style={metricItemStyle}>
            <span style={metricLabelStyle}>Cash Counted</span>
            <span style={metricValueStyle}>{formatNaira(todaySummary.cashKobo)}</span>
          </div>
          <div style={metricItemStyle}>
            <span style={metricLabelStyle}>Bank Transfers</span>
            <span style={metricValueStyle}>{formatNaira(todaySummary.transferKobo)}</span>
          </div>
          <div style={metricItemStyle}>
            <span style={metricLabelStyle}>Customer Credit</span>
            <span style={{ ...metricValueStyle, color: '#fbbf24' }}>
              {formatNaira(todaySummary.creditKobo)}
            </span>
          </div>
          <div style={metricItemStyle}>
            <span style={metricLabelStyle}>Card POS</span>
            <span style={metricValueStyle}>{formatNaira(todaySummary.cardKobo)}</span>
          </div>
          <div style={metricItemStyle}>
            <span style={metricLabelStyle}>Completed Sales</span>
            <span style={metricValueStyle}>{todaySummary.count}</span>
          </div>
        </div>
      </div>

      {/* Sales Transactions Table */}
      <div style={tableContainerStyle} className="glass-panel">
        <div style={tableHeaderBarStyle}>
          <h4 style={{ fontWeight: 700 }}>Transaction History</h4>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {sales.length} record(s)
          </span>
        </div>

        <table style={tableStyle}>
          <thead>
            <tr style={thRowStyle}>
              <th style={thStyle}>Receipt #</th>
              <th style={thStyle}>Timestamp</th>
              <th style={thStyle}>Items</th>
              <th style={thStyle}>Tenders</th>
              <th style={thStyle}>Total</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((e) => {
              const sale = e.payload;
              const isVoid = stockState.voided[sale.saleId] === true;

              return (
                <tr key={e.id} style={trStyle}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {sale.receiptNo}
                  </td>
                  <td style={{ ...tdStyle, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </td>
                  <td style={tdStyle}>{sale.lines.length} line(s)</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {sale.tenders.map((t, idx) => (
                        <span
                          key={idx}
                          className="badge badge-cyan"
                          style={{ fontSize: '0.65rem' }}
                        >
                          {t.method}: {formatNaira(t.amountKobo)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                    <span
                      style={{
                        textDecoration: isVoid ? 'line-through' : 'none',
                        color: isVoid ? '#f43f5e' : '#f8fafc',
                      }}
                    >
                      {formatNaira(sale.totalKobo)}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span className={`badge ${isVoid ? 'badge-rose' : 'badge-emerald'}`}>
                      {isVoid ? 'Voided' : 'Completed'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button
                      onClick={() => setSelectedSale(e)}
                      className="btn-secondary"
                      style={{ padding: '6px 14px', borderRadius: 8, fontSize: '0.8rem' }}
                    >
                      View Receipt
                    </button>
                  </td>
                </tr>
              );
            })}
            {sales.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}
                >
                  No sales recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Receipt Modal */}
      <ReceiptModal
        saleEvent={selectedSale}
        onClose={() => setSelectedSale(null)}
        onVoided={loadSales}
      />

      {/* End of Day Cash Up Modal */}
      {isCloseDayModalOpen && (
        <div style={overlayStyle}>
          <div style={modalStyle} className="glass-panel">
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontWeight: 700 }}>End-of-Day Cash-Up (DAY_CLOSED)</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Date: {todayStr}</p>
              </div>
              <button onClick={() => setIsCloseDayModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCloseDaySubmit} style={{ padding: 20 }}>
              <div style={infoBoxStyle}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>System Expected Cash:</span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                    {formatNaira(todaySummary.cashKobo)}
                  </span>
                </div>
              </div>

              <div style={{ margin: '16px 0' }}>
                <label style={labelStyle}>Actual Cash in Till Drawer (₦) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={countedCashNaira}
                  onChange={(e) => setCountedCashNaira(e.target.value)}
                  style={inputStyle}
                  className="mono"
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Reconciliation Note (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. ₦500 shortage due to coin change rounding"
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setIsCloseDayModalOpen(false)}
                  className="btn-secondary"
                  style={modalBtnStyle}
                >
                  Cancel
                </button>
                <button type="submit" className="glow-btn" style={modalBtnStyle}>
                  Record DAY_CLOSED
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const summaryPanelStyle: React.CSSProperties = {
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const closeDayBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 10,
  fontSize: '0.8rem',
  fontWeight: 600,
};

const metricsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 14,
};

const metricItemStyle: React.CSSProperties = {
  padding: 12,
  background: 'rgba(15, 23, 42, 0.5)',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: '0.04em',
};

const metricValueStyle: React.CSSProperties = {
  fontSize: '1.25rem',
  fontWeight: 800,
  fontFamily: 'var(--font-mono)',
};

const tableContainerStyle: React.CSSProperties = {
  overflowX: 'auto',
};

const tableHeaderBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid var(--border-subtle)',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
  fontSize: '0.9rem',
};

const thRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border-subtle)',
};

const thStyle: React.CSSProperties = {
  padding: '12px 18px',
  color: 'var(--text-muted)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const trStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(148, 163, 184, 0.06)',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 18px',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(5, 8, 16, 0.85)',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 440,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid var(--border-subtle)',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-muted)',
  fontSize: '1.2rem',
  padding: 6,
  borderRadius: 8,
};

const infoBoxStyle: React.CSSProperties = {
  padding: 12,
  background: 'rgba(15, 23, 42, 0.6)',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  marginBottom: 6,
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 8,
  background: 'var(--bg-input)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-main)',
  fontSize: '0.9rem',
};

const modalBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 10,
  fontSize: '0.9rem',
};
