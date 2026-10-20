import React, { useState, useMemo } from 'react';
import { formatNaira, type NdekoEvent } from '@ndeko/core';
import { stockLevel, type ProductView } from '@ndeko/projections';
import type { ProductUpsertedV1, StockAdjustedV1 } from '@ndeko/schemas';
import { useNdeko } from '../context/NdekoContext';

export const InventoryView: React.FC = () => {
  const {
    products,
    stockState,
    config,
    negativeStockAlerts,
    createOrUpdateProduct,
    receiveStock,
    adjustStock,
    getProductLedger,
  } = useNdeko();

  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ProductView | null>(null);

  // Modals state
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [ledgerEvents, setLedgerEvents] = useState<NdekoEvent[]>([]);

  // Form states
  const [prodForm, setProdForm] = useState<{
    name: string;
    barcode: string;
    priceNaira: string;
    costNaira: string;
    minStockQtyUnits: string;
    unit: NonNullable<ProductUpsertedV1['unit']>;
  }>({
    name: '',
    barcode: '',
    priceNaira: '',
    costNaira: '',
    minStockQtyUnits: '5',
    unit: 'each',
  });

  const [receiveForm, setReceiveForm] = useState({
    qtyUnits: '',
    costNaira: '',
    supplier: '',
    note: '',
  });

  const [adjustForm, setAdjustForm] = useState<{
    qtyDeltaUnits: string;
    reason: StockAdjustedV1['reason'];
    note: string;
  }>({
    qtyDeltaUnits: '',
    reason: 'COUNT',
    note: '',
  });

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)),
    );
  }, [products, search]);

  const handleOpenAddProduct = () => {
    setSelectedProduct(null);
    setProdForm({
      name: '',
      barcode: '',
      priceNaira: '',
      costNaira: '',
      minStockQtyUnits: '5',
      unit: 'each',
    });
    setIsProductModalOpen(true);
  };

  const handleOpenEditProduct = (p: ProductView) => {
    setSelectedProduct(p);
    setProdForm({
      name: p.name || '',
      barcode: p.barcode || '',
      priceNaira: p.priceKobo ? (p.priceKobo / 100).toString() : '',
      costNaira: p.costKobo ? (p.costKobo / 100).toString() : '',
      minStockQtyUnits: p.minStockQty ? (p.minStockQty / 1000).toString() : '5',
      unit: (p.unit as NonNullable<ProductUpsertedV1['unit']>) || 'each',
    });
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceKobo = Math.round(parseFloat(prodForm.priceNaira || '0') * 100);
    const costKobo = prodForm.costNaira
      ? Math.round(parseFloat(prodForm.costNaira) * 100)
      : undefined;
    const minStockQty = prodForm.minStockQtyUnits
      ? Math.round(parseFloat(prodForm.minStockQtyUnits) * 1000)
      : undefined;

    await createOrUpdateProduct({
      productId: selectedProduct?.productId,
      name: prodForm.name,
      barcode: prodForm.barcode || null,
      priceKobo,
      costKobo,
      minStockQty,
      unit: prodForm.unit,
    });
    setIsProductModalOpen(false);
  };

  const handleOpenReceive = (p: ProductView) => {
    setSelectedProduct(p);
    setReceiveForm({
      qtyUnits: '',
      costNaira: p.costKobo ? (p.costKobo / 100).toString() : '',
      supplier: '',
      note: '',
    });
    setIsReceiveModalOpen(true);
  };

  const handleSaveReceive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    const qtyMilli = Math.round(parseFloat(receiveForm.qtyUnits) * 1000);
    const costKobo = receiveForm.costNaira
      ? Math.round(parseFloat(receiveForm.costNaira) * 100)
      : undefined;
    if (qtyMilli <= 0) return;

    await receiveStock(
      selectedProduct.productId,
      qtyMilli,
      costKobo,
      receiveForm.supplier.trim() || undefined,
      receiveForm.note.trim() || undefined,
    );
    setIsReceiveModalOpen(false);
  };

  const handleOpenAdjust = (p: ProductView) => {
    setSelectedProduct(p);
    setAdjustForm({ qtyDeltaUnits: '', reason: 'COUNT', note: '' });
    setIsAdjustModalOpen(true);
  };

  const handleSaveAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    const qtyDeltaMilli = Math.round(parseFloat(adjustForm.qtyDeltaUnits) * 1000);
    if (qtyDeltaMilli === 0) return;

    await adjustStock(
      selectedProduct.productId,
      qtyDeltaMilli,
      adjustForm.reason,
      adjustForm.note || undefined,
    );
    setIsAdjustModalOpen(false);
  };

  const handleOpenLedger = async (p: ProductView) => {
    setSelectedProduct(p);
    const events = await getProductLedger(p.productId);
    setLedgerEvents(events);
    setIsLedgerOpen(true);
  };

  return (
    <div style={containerStyle}>
      {/* Overview Cards */}
      <div style={statsRowStyle}>
        <div style={statCardStyle} className="glass-panel">
          <span style={statLabelStyle}>Total Catalog Items</span>
          <span style={statValueStyle}>{products.length}</span>
        </div>
        <div style={statCardStyle} className="glass-panel">
          <span style={statLabelStyle}>Active Branch</span>
          <span style={{ ...statValueStyle, color: '#38bdf8' }}>{config.branchCode}</span>
        </div>
        <div style={statCardStyle} className="glass-panel">
          <span style={statLabelStyle}>Reconciliation Alerts</span>
          <span
            style={{
              ...statValueStyle,
              color: negativeStockAlerts.length > 0 ? '#f43f5e' : '#34d399',
            }}
          >
            {negativeStockAlerts.length}
          </span>
        </div>
      </div>

      {/* Negative Stock Alerts Banner */}
      {negativeStockAlerts.length > 0 && (
        <div style={alertBoxStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.4rem' }}>⚠️</span>
            <div>
              <h4 style={{ fontWeight: 700, color: '#fb7185' }}>
                Negative Stock Reconciliation Required
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {negativeStockAlerts.length} product(s) have sold below on-hand stock. As per Ndekọ
                core principles: sales are never rejected. Verify physical deliveries or post
                adjustment receipts.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header with Search and Add Product Button */}
      <div style={actionBarContainerStyle}>
        <div style={searchWrapperStyle} className="glass-panel">
          <span>🔍</span>
          <input
            type="text"
            placeholder="Search products or barcodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={searchInputStyle}
          />
        </div>
        <button onClick={handleOpenAddProduct} className="glow-btn" style={addProdBtnStyle}>
          + New Product
        </button>
      </div>

      {/* Products Table */}
      <div style={tableContainerStyle} className="glass-panel">
        <table style={tableStyle}>
          <thead>
            <tr style={tableHeaderRowStyle}>
              <th style={thStyle}>Product</th>
              <th style={thStyle}>Barcode</th>
              <th style={thStyle}>Unit Price</th>
              <th style={thStyle}>On Hand</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((p) => {
              const currentStockMilli = stockLevel(stockState, config.branchId, p.productId);
              const currentQty = currentStockMilli / 1000;
              const isNegative = currentStockMilli < 0;
              const thresholdMilli = p.minStockQty ?? 5000;
              const isLowStock = currentStockMilli <= thresholdMilli && currentStockMilli > 0;

              return (
                <tr key={p.productId} style={tableRowStyle}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                      ID: {p.productId.slice(0, 8)}...
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                    {p.barcode || '—'}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {formatNaira(p.priceKobo ?? 0)}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    <span
                      style={{
                        color: isNegative ? '#f43f5e' : currentQty === 0 ? '#f59e0b' : '#34d399',
                      }}
                    >
                      {currentQty.toLocaleString()} {p.unit || 'each'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span
                      className={`badge ${
                        isNegative
                          ? 'badge-rose'
                          : currentQty === 0
                            ? 'badge-rose'
                            : isLowStock
                              ? 'badge-amber'
                              : 'badge-emerald'
                      }`}
                    >
                      {isNegative
                        ? 'Deficit'
                        : currentQty === 0
                          ? 'Out of stock'
                          : isLowStock
                            ? `Low (${currentQty})`
                            : 'In stock'}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button
                        onClick={() => handleOpenReceive(p)}
                        className="btn-secondary"
                        style={actionBtnStyle}
                        title="Receive Stock"
                      >
                        + Stock
                      </button>
                      <button
                        onClick={() => handleOpenAdjust(p)}
                        className="btn-secondary"
                        style={actionBtnStyle}
                        title="Adjust Stock"
                      >
                        Adjust
                      </button>
                      <button
                        onClick={() => handleOpenLedger(p)}
                        className="btn-secondary"
                        style={actionBtnStyle}
                        title="View Immutable Ledger"
                      >
                        📜
                      </button>
                      <button
                        onClick={() => handleOpenEditProduct(p)}
                        className="btn-secondary"
                        style={actionBtnStyle}
                        title="Edit Details"
                      >
                        ✏️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add / Edit Product Modal */}
      {isProductModalOpen && (
        <div style={overlayStyle}>
          <div style={modalStyle} className="glass-panel">
            <div style={modalHeaderStyle}>
              <h3 style={{ fontWeight: 700 }}>
                {selectedProduct ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button onClick={() => setIsProductModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveProduct} style={{ padding: 20 }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Product Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Indomie Instant Noodles 70g"
                  value={prodForm.name}
                  onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div style={formRowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Barcode</label>
                  <input
                    type="text"
                    placeholder="e.g. 089686010839"
                    value={prodForm.barcode}
                    onChange={(e) => setProdForm({ ...prodForm, barcode: e.target.value })}
                    style={inputStyle}
                    className="mono"
                  />
                </div>
                <div style={{ width: 120 }}>
                  <label style={labelStyle}>Unit</label>
                  <select
                    value={prodForm.unit}
                    onChange={(e) =>
                      setProdForm({
                        ...prodForm,
                        unit: e.target.value as NonNullable<ProductUpsertedV1['unit']>,
                      })
                    }
                    style={selectStyle}
                  >
                    <option value="each">each</option>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="litre">litre</option>
                    <option value="pack">pack</option>
                    <option value="carton">carton</option>
                  </select>
                </div>
              </div>
              <div style={formRowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Selling Price (₦) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={prodForm.priceNaira}
                    onChange={(e) => setProdForm({ ...prodForm, priceNaira: e.target.value })}
                    style={inputStyle}
                    className="mono"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Cost Price (₦)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={prodForm.costNaira}
                    onChange={(e) => setProdForm({ ...prodForm, costNaira: e.target.value })}
                    style={inputStyle}
                    className="mono"
                  />
                </div>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>
                  Low-Stock Alert Threshold ({prodForm.unit || 'units'})
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="e.g. 5"
                  value={prodForm.minStockQtyUnits}
                  onChange={(e) => setProdForm({ ...prodForm, minStockQtyUnits: e.target.value })}
                  style={inputStyle}
                  className="mono"
                />
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-dim)',
                    marginTop: 4,
                    display: 'block',
                  }}
                >
                  Alerts show in Reconciliation when stock drops to or below this level.
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="btn-secondary"
                  style={modalBtnStyle}
                >
                  Cancel
                </button>
                <button type="submit" className="glow-btn" style={modalBtnStyle}>
                  Save Product
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Stock Modal */}
      {isReceiveModalOpen && selectedProduct && (
        <div style={overlayStyle}>
          <div style={modalStyle} className="glass-panel">
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontWeight: 700 }}>Receive Stock</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {selectedProduct.name}
                </p>
              </div>
              <button onClick={() => setIsReceiveModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveReceive} style={{ padding: 20 }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>
                  Quantity Received ({selectedProduct.unit || 'units'}) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  required
                  placeholder="e.g. 50"
                  value={receiveForm.qtyUnits}
                  onChange={(e) => setReceiveForm({ ...receiveForm, qtyUnits: e.target.value })}
                  style={inputStyle}
                  className="mono"
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Supplier Unit Cost (₦)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 450.00"
                  value={receiveForm.costNaira}
                  onChange={(e) => setReceiveForm({ ...receiveForm, costNaira: e.target.value })}
                  style={inputStyle}
                  className="mono"
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Supplier / Vendor</label>
                <input
                  type="text"
                  placeholder="e.g. Dangote Sugar Refinery / Garki Market"
                  value={receiveForm.supplier}
                  onChange={(e) => setReceiveForm({ ...receiveForm, supplier: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Note / Invoice Ref</label>
                <input
                  type="text"
                  placeholder="e.g. Batch #409 from Garki Market"
                  value={receiveForm.note}
                  onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setIsReceiveModalOpen(false)}
                  className="btn-secondary"
                  style={modalBtnStyle}
                >
                  Cancel
                </button>
                <button type="submit" className="glow-btn" style={modalBtnStyle}>
                  Record Stock In
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {isAdjustModalOpen && selectedProduct && (
        <div style={overlayStyle}>
          <div style={modalStyle} className="glass-panel">
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontWeight: 700 }}>Adjust Stock Count</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {selectedProduct.name}
                </p>
              </div>
              <button onClick={() => setIsAdjustModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveAdjust} style={{ padding: 20 }}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>
                  Delta Quantity (e.g. -2 for damage, +5 for count correction) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  required
                  placeholder="-1 or +2"
                  value={adjustForm.qtyDeltaUnits}
                  onChange={(e) => setAdjustForm({ ...adjustForm, qtyDeltaUnits: e.target.value })}
                  style={inputStyle}
                  className="mono"
                />
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Reason (Mandatory by Architecture) *</label>
                <select
                  value={adjustForm.reason}
                  onChange={(e) =>
                    setAdjustForm({
                      ...adjustForm,
                      reason: e.target.value as StockAdjustedV1['reason'],
                    })
                  }
                  style={selectStyle}
                >
                  <option value="COUNT">COUNT (Physical count reconciliation)</option>
                  <option value="DAMAGE">DAMAGE (Broken / spoiled items)</option>
                  <option value="EXPIRY">EXPIRY (Past shelf life)</option>
                  <option value="THEFT">THEFT (Pilferage / missing)</option>
                  <option value="OTHER">OTHER (Special circumstances)</option>
                </select>
              </div>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Explanation Note</label>
                <input
                  type="text"
                  placeholder="Details on what happened..."
                  value={adjustForm.note}
                  onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="btn-secondary"
                  style={modalBtnStyle}
                >
                  Cancel
                </button>
                <button type="submit" className="glow-btn" style={modalBtnStyle}>
                  Post Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Ledger Modal */}
      {isLedgerOpen && selectedProduct && (
        <div style={overlayStyle}>
          <div style={{ ...modalStyle, maxWidth: 600 }} className="glass-panel">
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontWeight: 700 }}>Immutable Stock Ledger</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {selectedProduct.name}
                </p>
              </div>
              <button onClick={() => setIsLedgerOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>
            <div style={{ padding: 20, maxHeight: 420, overflowY: 'auto' }}>
              {ledgerEvents.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>
                  No historical events recorded.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ledgerEvents.map((e) => (
                    <div
                      key={e.id}
                      style={{
                        padding: 12,
                        background: 'rgba(15, 23, 42, 0.5)',
                        borderRadius: 10,
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontWeight: 700, color: '#38bdf8' }}>{e.type}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                          {new Date(e.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        Event ID: {e.id.slice(0, 18)}... • HLC: {e.hlc}
                      </div>
                      <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-main)' }}>
                        {JSON.stringify(e.payload)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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

const statsRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 16,
};

const statCardStyle: React.CSSProperties = {
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: '0.04em',
};

const statValueStyle: React.CSSProperties = {
  fontSize: '1.6rem',
  fontWeight: 800,
  fontFamily: 'var(--font-mono)',
};

const alertBoxStyle: React.CSSProperties = {
  padding: '14px 18px',
  background: 'rgba(244, 63, 94, 0.12)',
  border: '1px solid rgba(244, 63, 94, 0.3)',
  borderRadius: 14,
};

const actionBarContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
};

const searchWrapperStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 420,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
};

const searchInputStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--text-main)',
  fontSize: '0.9rem',
  width: '100%',
};

const addProdBtnStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 10,
  fontSize: '0.9rem',
};

const tableContainerStyle: React.CSSProperties = {
  overflowX: 'auto',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  textAlign: 'left',
  fontSize: '0.9rem',
};

const tableHeaderRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border-subtle)',
};

const thStyle: React.CSSProperties = {
  padding: '14px 18px',
  color: 'var(--text-muted)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: '0.05em',
};

const tableRowStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(148, 163, 184, 0.06)',
};

const tdStyle: React.CSSProperties = {
  padding: '14px 18px',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  fontSize: '0.8rem',
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
  maxWidth: 480,
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

const formGroupStyle: React.CSSProperties = {
  marginBottom: 16,
};

const formRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginBottom: 16,
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

const selectStyle: React.CSSProperties = {
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
