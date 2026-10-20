import React, { useState } from 'react';
import type { StockAdjustedV1 } from '@ndeko/schemas';
import { useNdeko } from '../context/NdekoContext';

export const ReconciliationView: React.FC = () => {
  const {
    negativeStockAlerts,
    lowStockAlerts,
    products,
    syncState,
    receiveStock,
    adjustStock,
    dismissDriftWarning,
  } = useNdeko();

  const [activeTab, setActiveTab] = useState<'negative' | 'lowstock' | 'system'>('negative');

  // Modals for resolving negative stock
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
  const [resolutionMode, setResolutionMode] = useState<'receive' | 'adjust'>('adjust');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const [resolveForm, setResolveForm] = useState({
    qtyUnits: '',
    reason: 'COUNT' as StockAdjustedV1['reason'],
    note: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedProduct = products.find((p) => p.productId === selectedProductId);

  const handleOpenResolve = (
    productId: string,
    mode: 'receive' | 'adjust',
    suggestedUnits: number,
  ) => {
    setSelectedProductId(productId);
    setResolutionMode(mode);
    setResolveForm({
      qtyUnits: Math.abs(suggestedUnits).toString(),
      reason: 'COUNT',
      note:
        mode === 'receive'
          ? 'Restocking after oversold offline sale'
          : 'Stock count reconciliation',
    });
    setErrorMsg(null);
    setIsResolveModalOpen(true);
  };

  const handleSaveResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;
    const units = parseFloat(resolveForm.qtyUnits || '0');
    if (units <= 0) {
      setErrorMsg('Quantity must be greater than zero');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const milli = Math.round(units * 1000);
      if (resolutionMode === 'receive') {
        await receiveStock(
          selectedProductId,
          milli,
          selectedProduct?.costKobo,
          undefined,
          resolveForm.note || 'Reconciliation delivery receipt',
        );
      } else {
        // Count adjustment: we set qtyDelta to replenish the deficit
        await adjustStock(
          selectedProductId,
          milli,
          resolveForm.reason,
          resolveForm.note || 'Physical count adjustment',
        );
      }
      setIsResolveModalOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error applying resolution');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerSectionStyle}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Reconciliation Inbox</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Audit concurrent offline sales, resolve negative stock deficits, and review sync flags.
          </p>
        </div>
      </div>

      {/* Concept Explain Banner */}
      <div style={explainBannerStyle} className="glass-panel">
        <div style={{ fontSize: '1.4rem' }}>💡</div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-main)' }}>
            How Ndekọ Handles Offline Concurrency:
          </strong>{' '}
          When two tills sell the last available unit simultaneously while offline, neither till
          blocks the cashier. Both sales stand and are accepted. The stock projection records a
          temporary deficit until physical inventory is received or counted below.
        </div>
      </div>

      {/* Nav Tabs */}
      <div style={tabNavStyle}>
        <button
          onClick={() => setActiveTab('negative')}
          style={{ ...tabBtnStyle, ...(activeTab === 'negative' ? activeTabBtnStyle : {}) }}
        >
          ⚠️ Negative Stock Deficits ({negativeStockAlerts.length})
        </button>
        <button
          onClick={() => setActiveTab('lowstock')}
          style={{ ...tabBtnStyle, ...(activeTab === 'lowstock' ? activeTabBtnStyle : {}) }}
        >
          📉 Low-Stock Alerts ({lowStockAlerts.length})
        </button>
        <button
          onClick={() => setActiveTab('system')}
          style={{ ...tabBtnStyle, ...(activeTab === 'system' ? activeTabBtnStyle : {}) }}
        >
          🛡️ Sync & Clock Health {syncState.driftWarning && '(!)'}
        </button>
      </div>

      {/* Tab 1: Negative Stock Deficits */}
      {activeTab === 'negative' && (
        <div style={tableCardStyle} className="glass-panel">
          <table style={tableStyle}>
            <thead>
              <tr style={tableHeadRowStyle}>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>Branch</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Current Deficit</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Reconcile Actions</th>
              </tr>
            </thead>
            <tbody>
              {negativeStockAlerts.map((alert) => {
                const prod = products.find((p) => p.productId === alert.productId);
                const deficitUnits = Math.abs(alert.qty / 1000);
                return (
                  <tr key={`${alert.branchId}-${alert.productId}`} style={tableRowStyle}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                        {prod?.name || alert.productId}
                      </div>
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-dim)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {prod?.barcode ? `Barcode: ${prod.barcode}` : `ID: ${alert.productId}`}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span className="badge badge-cyan">{alert.branchId}</span>
                    </td>
                    <td
                      style={{ ...tdStyle, textAlign: 'right', fontWeight: 800, color: '#f43f5e' }}
                    >
                      -{deficitUnits} {prod?.unit || 'units'}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                      }}
                    >
                      <span className="badge badge-amber">Offline Deficit</span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleOpenResolve(alert.productId, 'adjust', deficitUnits)}
                          className="glow-btn"
                          style={actionBtnStyle}
                        >
                          ✏️ Physical Count
                        </button>
                        <button
                          onClick={() =>
                            handleOpenResolve(alert.productId, 'receive', deficitUnits)
                          }
                          className="btn-secondary"
                          style={actionBtnStyle}
                        >
                          📦 Receive Delivery
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {negativeStockAlerts.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}
                  >
                    ✨ All stock levels are balanced. No negative stock deficits detected!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Low-Stock Alerts */}
      {activeTab === 'lowstock' && (
        <div style={tableCardStyle} className="glass-panel">
          <table style={tableStyle}>
            <thead>
              <tr style={tableHeadRowStyle}>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>Barcode</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Current Stock</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Threshold</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {lowStockAlerts.map(({ product, currentStockMilli, thresholdMilli }) => {
                const stockQty = currentStockMilli / 1000;
                const thresholdQty = thresholdMilli / 1000;
                const isOut = currentStockMilli <= 0;

                return (
                  <tr key={product.productId} style={tableRowStyle}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 700 }}>{product.name}</div>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color: 'var(--text-dim)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.8rem',
                      }}
                    >
                      {product.barcode || '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800 }}>
                      <span style={{ color: isOut ? '#f43f5e' : '#f59e0b' }}>
                        {stockQty} {product.unit}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: 'var(--text-muted)' }}>
                      {thresholdQty} {product.unit}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <span className={`badge ${isOut ? 'badge-rose' : 'badge-amber'}`}>
                        {isOut ? 'Out of Stock' : 'Low Stock'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {lowStockAlerts.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}
                  >
                    ✨ Inventory healthy. All active products are above low-stock thresholds.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: System & Sync Health */}
      {activeTab === 'system' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={kpiCardStyle} className="glass-panel">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>
              Hybrid Logical Clock Status
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 14 }}>
              Ndekọ uses Hybrid Logical Clocks (HLC) combining device wall time with a logical
              counter. Events sort chronologically even across multiple tills without centralized
              lock contention.
            </p>
            {syncState.driftWarning ? (
              <div style={errorBannerStyle}>
                <div>
                  <strong>⚠️ Clock Drift Detected:</strong> Remote event HLC was observed further
                  ahead than local wall clock. The events were safely ingested, but ensure device
                  time is set accurately.
                </div>
                <button
                  onClick={dismissDriftWarning}
                  className="btn-secondary"
                  style={{ marginTop: 8, padding: '6px 12px' }}
                >
                  Dismiss Warning
                </button>
              </div>
            ) : (
              <div style={healthOkStyle}>
                <span>
                  ✓ Local clock and remote peers are synchronized within normal drift bounds.
                </span>
              </div>
            )}
          </div>

          <div style={kpiCardStyle} className="glass-panel">
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>
              Replication State
            </h3>
            <div style={{ display: 'flex', gap: 24, fontSize: '0.9rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Sync Status: </span>
                <strong style={{ color: 'var(--accent-cyan)' }}>
                  {syncState.status.toUpperCase()}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Pending Push Events: </span>
                <strong>{syncState.pendingCount}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Last Sync: </span>
                <strong>
                  {syncState.lastSyncTime
                    ? new Date(syncState.lastSyncTime).toLocaleTimeString('en-NG')
                    : 'Never'}
                </strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Modal */}
      {isResolveModalOpen && selectedProduct && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle} className="glass-panel">
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                  {resolutionMode === 'receive'
                    ? 'Receive Replenishment Delivery'
                    : 'Record Physical Inventory Count'}
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Product:{' '}
                  <strong style={{ color: 'var(--text-main)' }}>{selectedProduct.name}</strong>
                </p>
              </div>
              <button onClick={() => setIsResolveModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>

            {errorMsg && <div style={errorBannerStyle}>⚠️ {errorMsg}</div>}

            <form onSubmit={handleSaveResolution}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>
                  {resolutionMode === 'receive' ? 'Quantity Received' : 'Count Correction Quantity'}{' '}
                  ({selectedProduct.unit || 'units'}) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  value={resolveForm.qtyUnits}
                  onChange={(e) => setResolveForm({ ...resolveForm, qtyUnits: e.target.value })}
                  style={inputStyle}
                />
              </div>

              {resolutionMode === 'adjust' && (
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Adjustment Reason *</label>
                  <select
                    value={resolveForm.reason}
                    onChange={(e) =>
                      setResolveForm({
                        ...resolveForm,
                        reason: e.target.value as StockAdjustedV1['reason'],
                      })
                    }
                    style={inputStyle}
                  >
                    <option value="COUNT">Physical Count Audit</option>
                    <option value="DAMAGE">Damaged Goods</option>
                    <option value="EXPIRY">Expired Stock</option>
                    <option value="THEFT">Shrinkage / Theft</option>
                    <option value="OTHER">Other Reason</option>
                  </select>
                </div>
              )}

              <div style={formGroupStyle}>
                <label style={labelStyle}>Audit Note</label>
                <input
                  type="text"
                  placeholder="e.g. Physical count reconciliation"
                  value={resolveForm.note}
                  onChange={(e) => setResolveForm({ ...resolveForm, note: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div style={modalActionsStyle}>
                <button
                  type="button"
                  onClick={() => setIsResolveModalOpen(false)}
                  className="btn-secondary"
                  style={btnStyle}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="glow-btn" style={btnStyle}>
                  {isSubmitting ? 'Saving...' : 'Confirm Reconciliation'}
                </button>
              </div>
            </form>
          </div>
        </div>
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
  marginBottom: 20,
};

const explainBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '16px 20px',
  borderRadius: 'var(--radius-md)',
  marginBottom: 24,
  background: 'rgba(30, 41, 59, 0.4)',
  border: '1px solid var(--border-subtle)',
};

const tabNavStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 20,
};

const tabBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.88rem',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

const activeTabBtnStyle: React.CSSProperties = {
  background: 'rgba(16, 185, 129, 0.15)',
  borderColor: 'var(--accent-emerald)',
  color: '#ffffff',
  fontWeight: 700,
};

const tableCardStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
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
  fontSize: '0.9rem',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.78rem',
  fontWeight: 600,
};

const kpiCardStyle: React.CSSProperties = {
  padding: '24px',
  borderRadius: 'var(--radius-md)',
};

const healthOkStyle: React.CSSProperties = {
  padding: '12px 16px',
  background: 'rgba(16, 185, 129, 0.1)',
  border: '1px solid rgba(16, 185, 129, 0.3)',
  color: 'var(--accent-emerald)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.85rem',
};

const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.75)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
};

const modalCardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  padding: '24px',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-md)',
};

const modalHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-muted)',
  fontSize: '1.2rem',
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

const modalActionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  marginTop: 20,
};

const btnStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.85rem',
  fontWeight: 600,
};

const errorBannerStyle: React.CSSProperties = {
  padding: '12px 16px',
  background: 'rgba(244, 63, 94, 0.15)',
  border: '1px solid var(--accent-rose)',
  color: '#f43f5e',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.85rem',
  marginBottom: 16,
};
