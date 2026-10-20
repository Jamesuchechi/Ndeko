import React, { useState, useMemo } from 'react';
import { formatNaira, lineTotal } from '@ndeko/core';
import { stockLevel, type ProductView } from '@ndeko/projections';
import type { SaleRecordedV1 } from '@ndeko/schemas';
import type { NdekoEvent } from '@ndeko/core';
import { useNdeko, type CartLine } from '../context/NdekoContext';
import { BarcodeScannerModal } from '../components/BarcodeScannerModal';
import { ReceiptModal } from '../components/ReceiptModal';

export const PosView: React.FC = () => {
  const { products, stockState, config, recordSale } = useNdeko();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tenderMethod, setTenderMethod] = useState<'CASH' | 'TRANSFER' | 'CARD' | 'CREDIT'>('CASH');
  const [customerName, setCustomerName] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<NdekoEvent<SaleRecordedV1> | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Active products
  const activeProducts = useMemo(() => {
    return products.filter((p) => !p.archived);
  }, [products]);

  // Filtered by query or barcode
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeProducts;
    return activeProducts.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)),
    );
  }, [activeProducts, search]);

  const addToCart = (product: ProductView) => {
    const unitPriceKobo = product.priceKobo ?? 0;
    setCart((prev) => {
      const existing = prev.find((item) => item.product.productId === product.productId);
      if (existing) {
        const nextQty = existing.qty + 1000; // +1 unit
        return prev.map((item) =>
          item.product.productId === product.productId
            ? {
                ...item,
                qty: nextQty,
                lineTotalKobo: lineTotal(unitPriceKobo, nextQty),
              }
            : item,
        );
      }
      return [
        ...prev,
        {
          product,
          qty: 1000,
          unitPriceKobo,
          lineTotalKobo: lineTotal(unitPriceKobo, 1000),
        },
      ];
    });
  };

  const updateQuantity = (productId: string, deltaMilli: number) => {
    setCart(
      (prev) =>
        prev
          .map((item) => {
            if (item.product.productId === productId) {
              const nextQty = item.qty + deltaMilli;
              if (nextQty <= 0) return null;
              return {
                ...item,
                qty: nextQty,
                lineTotalKobo: lineTotal(item.unitPriceKobo, nextQty),
              };
            }
            return item;
          })
          .filter(Boolean) as CartLine[],
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product.productId !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setErrorMsg(null);
  };

  const cartTotalKobo = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.lineTotalKobo, 0);
  }, [cart]);

  const handleBarcodeDetected = (code: string) => {
    const found = activeProducts.find((p) => p.barcode === code);
    if (found) {
      addToCart(found);
    } else {
      setSearch(code);
      setErrorMsg(`No product found for barcode "${code}". You can add it in Inventory.`);
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (tenderMethod === 'CREDIT' && !customerName.trim()) {
      setErrorMsg('Customer name/phone is required for credit sales.');
      return;
    }
    setErrorMsg(null);
    setIsCheckingOut(true);

    try {
      const lines = cart.map((item) => ({
        productId: item.product.productId,
        qty: item.qty,
        unitPriceKobo: item.unitPriceKobo,
        lineTotalKobo: item.lineTotalKobo,
      }));

      const tenders = [
        {
          method: tenderMethod,
          amountKobo: cartTotalKobo,
        },
      ];

      const saleEvent = await recordSale({
        lines,
        tenders,
        totalKobo: cartTotalKobo,
        customerId: tenderMethod === 'CREDIT' ? customerName.trim() : undefined,
      });

      setCompletedSale(saleEvent);
      clearCart();
      setCustomerName('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error recording sale';
      setErrorMsg(msg);
    } finally {
      setIsCheckingOut(false);
    }
  };

  return (
    <div style={containerStyle}>
      {/* Product Catalog Column */}
      <div style={catalogColumnStyle}>
        {/* Search & Actions Bar */}
        <div style={searchBarStyle} className="glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>🔍</span>
            <input
              type="text"
              placeholder="Search products or type barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={searchInputStyle}
            />
            {search && (
              <button onClick={() => setSearch('')} style={clearSearchBtnStyle}>
                ✕
              </button>
            )}
          </div>
          <button
            onClick={() => setIsScannerOpen(true)}
            className="btn-secondary"
            style={scannerBtnStyle}
          >
            📷 Scan Barcode
          </button>
        </div>

        {errorMsg && (
          <div style={errorBannerStyle}>
            <span>⚠️ {errorMsg}</span>
            <button
              onClick={() => setErrorMsg(null)}
              style={{ background: 'transparent', color: 'inherit' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Products Grid */}
        <div style={gridStyle}>
          {filteredProducts.map((p) => {
            const currentStockMilli = stockLevel(stockState, config.branchId, p.productId);
            const stockQty = currentStockMilli / 1000;
            const isNegative = currentStockMilli < 0;
            const isOut = currentStockMilli === 0;

            return (
              <div
                key={p.productId}
                onClick={() => addToCart(p)}
                style={productCardStyle}
                className="glass-panel"
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={unitTagStyle}>{p.unit || 'each'}</span>
                  <span
                    className={`badge ${
                      isNegative ? 'badge-rose' : isOut ? 'badge-amber' : 'badge-emerald'
                    }`}
                  >
                    {isNegative ? `${stockQty} ${p.unit} (Oversold)` : `${stockQty} ${p.unit}`}
                  </span>
                </div>

                <div style={{ margin: '14px 0 10px' }}>
                  <h4 style={productTitleStyle}>{p.name}</h4>
                  {p.barcode && <p style={barcodeTextStyle}>Barcode: {p.barcode}</p>}
                </div>

                <div style={cardFooterStyle}>
                  <div style={priceTextStyle}>{formatNaira(p.priceKobo ?? 0)}</div>
                  <button className="glow-btn" style={addBtnStyle}>
                    +
                  </button>
                </div>
              </div>
            );
          })}
          {filteredProducts.length === 0 && (
            <div style={emptyStateStyle}>
              <p style={{ color: 'var(--text-muted)' }}>No products matching your search.</p>
            </div>
          )}
        </div>
      </div>

      {/* Cart & Checkout Panel */}
      <div style={cartPanelStyle} className="glass-panel">
        <div style={cartHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>🛒</span>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Current Sale</h3>
          </div>
          {cart.length > 0 && (
            <button onClick={clearCart} style={clearCartBtnStyle}>
              Clear
            </button>
          )}
        </div>

        {/* Cart items list */}
        <div style={cartItemsListStyle}>
          {cart.length === 0 ? (
            <div style={cartEmptyStyle}>
              <span style={{ fontSize: '2.5rem', opacity: 0.4 }}>🧾</span>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginTop: 8 }}>
                Cart is empty. Tap items or scan barcodes to begin sale.
              </p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.product.productId} style={cartItemRowStyle}>
                <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.product.name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {formatNaira(item.unitPriceKobo)} / {item.product.unit || 'unit'}
                  </div>
                </div>

                {/* Qty controls */}
                <div style={qtyControlsStyle}>
                  <button
                    onClick={() => updateQuantity(item.product.productId, -1000)}
                    style={qtyBtnStyle}
                  >
                    -
                  </button>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.9rem',
                      minWidth: 24,
                      textAlign: 'center',
                    }}
                  >
                    {item.qty / 1000}
                  </span>
                  <button
                    onClick={() => updateQuantity(item.product.productId, 1000)}
                    style={qtyBtnStyle}
                  >
                    +
                  </button>
                </div>

                <div style={{ textAlign: 'right', minWidth: 80 }}>
                  <div
                    style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.95rem' }}
                  >
                    {formatNaira(item.lineTotalKobo)}
                  </div>
                  <button
                    onClick={() => removeFromCart(item.product.productId)}
                    style={removeBtnStyle}
                  >
                    remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Tender and Totals */}
        <div style={checkoutSectionStyle}>
          {/* Tender Selector */}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 700,
              }}
            >
              Payment Method
            </label>
            <div style={tenderGridStyle}>
              {(['CASH', 'TRANSFER', 'CARD', 'CREDIT'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setTenderMethod(m)}
                  style={{
                    ...tenderBtnStyle,
                    ...(tenderMethod === m ? activeTenderBtnStyle : {}),
                  }}
                >
                  {m === 'CASH' && '💵 '}
                  {m === 'TRANSFER' && '📱 '}
                  {m === 'CARD' && '💳 '}
                  {m === 'CREDIT' && '🤝 '}
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Customer Input if Credit */}
          {tenderMethod === 'CREDIT' && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600 }}>
                Customer Name / Phone (Required for Credit)
              </label>
              <input
                type="text"
                placeholder="e.g. Alh. Bello / 08031234567"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                style={customerInputStyle}
              />
            </div>
          )}

          {/* Total Breakdown */}
          <div style={totalContainerStyle}>
            <span style={{ color: 'var(--text-muted)', fontSize: '1rem', fontWeight: 600 }}>
              Total Due
            </span>
            <span style={totalAmountStyle}>{formatNaira(cartTotalKobo)}</span>
          </div>

          {/* Action button */}
          <button
            onClick={handleCheckout}
            disabled={cart.length === 0 || isCheckingOut}
            className="glow-btn"
            style={completeSaleBtnStyle}
          >
            {isCheckingOut ? 'Recording Sale...' : `Charge ${formatNaira(cartTotalKobo)}`}
          </button>
        </div>
      </div>

      {/* Barcode scanner popup */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onDetected={handleBarcodeDetected}
      />

      {/* Printable Receipt Dialog */}
      <ReceiptModal saleEvent={completedSale} onClose={() => setCompletedSale(null)} />
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 20,
  padding: 24,
  height: 'calc(100vh - 72px)',
};

const catalogColumnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minWidth: 0,
};

const searchBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 18px',
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontSize: '0.95rem',
  color: 'var(--text-main)',
};

const clearSearchBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '0.9rem',
};

const scannerBtnStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 10,
  fontSize: '0.85rem',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 16,
  overflowY: 'auto',
  paddingRight: 4,
};

const productCardStyle: React.CSSProperties = {
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  cursor: 'pointer',
  transition: 'transform 0.15s ease, border-color 0.15s ease',
};

const unitTagStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-dim)',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const productTitleStyle: React.CSSProperties = {
  fontSize: '0.95rem',
  fontWeight: 700,
  lineHeight: 1.35,
};

const barcodeTextStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-dim)',
  fontFamily: 'var(--font-mono)',
  marginTop: 4,
};

const cardFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: 8,
};

const priceTextStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 800,
  color: '#34d399',
  fontFamily: 'var(--font-mono)',
};

const addBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  fontSize: '1.2rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

const emptyStateStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  textAlign: 'center',
  padding: 40,
};

const cartPanelStyle: React.CSSProperties = {
  width: 380,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const cartHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '16px 20px',
  borderBottom: '1px solid var(--border-subtle)',
};

const clearCartBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#f87171',
  fontSize: '0.8rem',
  fontWeight: 600,
};

const cartItemsListStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const cartEmptyStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 30,
};

const cartItemRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  background: 'rgba(15, 23, 42, 0.4)',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
};

const qtyControlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(30, 41, 59, 0.6)',
  padding: '2px 4px',
  borderRadius: 8,
};

const qtyBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  background: 'transparent',
  color: 'var(--text-main)',
  fontSize: '0.9rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
};

const removeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#f87171',
  fontSize: '0.7rem',
  marginTop: 2,
};

const checkoutSectionStyle: React.CSSProperties = {
  padding: 20,
  borderTop: '1px solid var(--border-subtle)',
  backgroundColor: 'rgba(15, 23, 42, 0.6)',
};

const tenderGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 6,
  marginTop: 6,
};

const tenderBtnStyle: React.CSSProperties = {
  padding: '8px 4px',
  borderRadius: 8,
  background: 'rgba(30, 41, 59, 0.6)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-muted)',
  fontSize: '0.75rem',
  fontWeight: 600,
};

const activeTenderBtnStyle: React.CSSProperties = {
  background: 'rgba(16, 185, 129, 0.2)',
  borderColor: '#10b981',
  color: '#34d399',
};

const customerInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--bg-input)',
  border: '1px solid rgba(245, 158, 11, 0.4)',
  color: 'var(--text-main)',
  fontSize: '0.85rem',
  marginTop: 4,
};

const totalContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 16,
};

const totalAmountStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 800,
  fontFamily: 'var(--font-mono)',
  color: '#f8fafc',
};

const completeSaleBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: 14,
  borderRadius: 12,
  fontSize: '1rem',
};

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 16px',
  backgroundColor: 'rgba(244, 63, 94, 0.15)',
  border: '1px solid rgba(244, 63, 94, 0.3)',
  borderRadius: 10,
  color: '#fb7185',
  fontSize: '0.85rem',
};
