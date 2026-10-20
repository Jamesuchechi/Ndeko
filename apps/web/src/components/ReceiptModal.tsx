import React, { useState } from 'react';
import { formatNaira, type NdekoEvent } from '@ndeko/core';
import type { SaleRecordedV1 } from '@ndeko/schemas';
import { useNdeko } from '../context/NdekoContext';

interface ReceiptModalProps {
  saleEvent: NdekoEvent<SaleRecordedV1> | null;
  onClose: () => void;
  onVoided?: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ saleEvent, onClose, onVoided }) => {
  const { products, voidSale, stockState } = useNdeko();
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState(false);

  if (!saleEvent) return null;

  const sale = saleEvent.payload;
  const isAlreadyVoided = stockState.voided[sale.saleId] === true;

  const getProductName = (productId: string) => {
    const p = products.find((prod) => prod.productId === productId);
    return p?.name || `Product (${productId.slice(0, 8)})`;
  };

  const handlePrint = () => {
    window.print();
  };

  const handleConfirmVoid = async () => {
    if (!voidReason.trim()) return;
    setIsSubmittingVoid(true);
    try {
      await voidSale(sale.saleId, voidReason);
      setIsVoiding(false);
      if (onVoided) onVoided();
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={modalStyle} className="glass-panel">
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.25rem' }}>🧾</span>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Receipt #{sale.receiptNo}</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {new Date(saleEvent.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            ✕
          </button>
        </div>

        {/* Printable Receipt Preview */}
        <div style={scrollAreaStyle}>
          <div id="printable-receipt" style={receiptPaperStyle}>
            {isAlreadyVoided && <div style={voidWatermarkStyle}>VOIDED</div>}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <h2
                style={{
                  fontSize: '1.15rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                NDEKỌ SHOP
              </h2>
              <p style={{ fontSize: '0.75rem', color: '#555' }}>
                Abuja Branch • POS #{saleEvent.deviceId}
              </p>
              <div style={{ borderBottom: '1px dashed #777', margin: '8px 0' }} />
              <p style={{ fontSize: '0.75rem', fontWeight: 600 }}>RECEIPT: {sale.receiptNo}</p>
              <p style={{ fontSize: '0.7rem', color: '#555' }}>
                {new Date(saleEvent.createdAt).toLocaleString()}
              </p>
            </div>

            <div style={{ borderBottom: '1px dashed #777', margin: '8px 0' }} />

            {/* Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8rem' }}>
              {sale.lines.map((line, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontWeight: 600 }}>{getProductName(line.productId)}</div>
                    <div style={{ fontSize: '0.75rem', color: '#555' }}>
                      {(line.qty / 1000).toLocaleString()} x {formatNaira(line.unitPriceKobo)}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>
                    {formatNaira(line.lineTotalKobo)}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderBottom: '1px dashed #777', margin: '10px 0' }} />

            {/* Totals */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '1rem',
                fontWeight: 800,
                margin: '6px 0',
              }}
            >
              <span>TOTAL</span>
              <span style={{ fontFamily: 'monospace' }}>{formatNaira(sale.totalKobo)}</span>
            </div>

            {/* Tender breakdown */}
            <div
              style={{
                fontSize: '0.75rem',
                color: '#444',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              {sale.tenders.map((tender, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Tender ({tender.method}):</span>
                  <span style={{ fontFamily: 'monospace' }}>{formatNaira(tender.amountKobo)}</span>
                </div>
              ))}
              {sale.customerId && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#10b981',
                    fontWeight: 600,
                  }}
                >
                  <span>Customer:</span>
                  <span>{sale.customerId}</span>
                </div>
              )}
            </div>

            <div style={{ borderBottom: '1px dashed #777', margin: '12px 0 8px' }} />

            <div
              style={{ textAlign: 'center', fontSize: '0.7rem', color: '#666', lineHeight: 1.4 }}
            >
              <p>Thank you for shopping with us!</p>
              <p style={{ fontSize: '0.65rem', marginTop: 4 }}>Powered by Ndekọ Offline OS</p>
            </div>
          </div>

          {/* Void Form if toggled */}
          {isVoiding && (
            <div
              style={{
                marginTop: 16,
                padding: 14,
                background: 'rgba(244, 63, 94, 0.1)',
                borderRadius: 12,
                border: '1px solid rgba(244, 63, 94, 0.3)',
              }}
            >
              <h4 style={{ color: '#fb7185', fontSize: '0.9rem', marginBottom: 6 }}>
                Void Sale Confirmation
              </h4>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 10 }}>
                Voiding reverses stock movements and marks this transaction as void. It is recorded
                immutably as a SALE_VOIDED event.
              </p>
              <input
                type="text"
                placeholder="Reason for void (e.g. wrong item / returned)"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                style={inputStyle}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={handleConfirmVoid}
                  disabled={!voidReason.trim() || isSubmittingVoid}
                  className="btn-danger"
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8 }}
                >
                  {isSubmittingVoid ? 'Voiding...' : 'Confirm Void'}
                </button>
                <button
                  onClick={() => setIsVoiding(false)}
                  className="btn-secondary"
                  style={{ padding: '10px 16px', borderRadius: 8 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={footerStyle}>
          {!isAlreadyVoided && !isVoiding && (
            <button
              onClick={() => setIsVoiding(true)}
              className="btn-danger"
              style={{ padding: '10px 16px', borderRadius: 10, fontSize: '0.85rem' }}
            >
              Void Sale
            </button>
          )}

          <div style={{ display: 'flex', gap: 10, marginLeft: 'auto' }}>
            <button
              onClick={handlePrint}
              className="glow-btn"
              style={{
                padding: '10px 20px',
                borderRadius: 10,
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              🖨️ Print Receipt
            </button>
            <button
              onClick={onClose}
              className="btn-secondary"
              style={{ padding: '10px 16px', borderRadius: 10 }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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
  maxHeight: '90vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const headerStyle: React.CSSProperties = {
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

const scrollAreaStyle: React.CSSProperties = {
  padding: 20,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const receiptPaperStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: 320,
  backgroundColor: '#ffffff',
  color: '#000000',
  borderRadius: 8,
  padding: '20px 18px',
  boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
  fontFamily: 'var(--font-mono)',
  overflow: 'hidden',
};

const voidWatermarkStyle: React.CSSProperties = {
  position: 'absolute',
  top: '40%',
  left: '50%',
  transform: 'translate(-50%, -50%) rotate(-35deg)',
  color: 'rgba(239, 68, 68, 0.35)',
  fontSize: '3rem',
  fontWeight: 900,
  letterSpacing: '0.1em',
  border: '6px solid rgba(239, 68, 68, 0.35)',
  padding: '4px 18px',
  borderRadius: 12,
  pointerEvents: 'none',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '14px 20px',
  borderTop: '1px solid var(--border-subtle)',
  backgroundColor: 'rgba(15, 23, 42, 0.4)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  background: 'var(--bg-input)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-main)',
  fontSize: '0.85rem',
};
