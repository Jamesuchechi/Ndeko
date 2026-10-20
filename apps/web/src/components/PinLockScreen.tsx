import React, { useState } from 'react';
import { useNdeko } from '../context/NdekoContext';

export const PinLockScreen: React.FC = () => {
  const { unlockTill, config } = useNdeko();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleDigit = (d: string) => {
    if (pin.length < 4) {
      const next = pin + d;
      setPin(next);
      setError(false);
      if (next.length === 4) {
        if (!unlockTill(next)) {
          setError(true);
          setTimeout(() => setPin(''), 500);
        }
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setError(false);
  };

  return (
    <div style={lockOverlayStyle}>
      <div style={containerStyle} className="glass-panel">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={iconBadgeStyle}>🔒</div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 12 }}>Till Locked</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            Branch {config.branchCode} • Till {config.deviceCode}
          </p>
        </div>

        {/* PIN Dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 28 }}>
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: error ? '2px solid #f43f5e' : '2px solid #334155',
                backgroundColor: pin.length > idx ? (error ? '#f43f5e' : '#10b981') : 'transparent',
                boxShadow: pin.length > idx && !error ? '0 0 10px rgba(16, 185, 129, 0.5)' : 'none',
                transition: 'all 0.15s ease',
              }}
            />
          ))}
        </div>

        {error && (
          <p
            style={{ color: '#fb7185', fontSize: '0.8rem', textAlign: 'center', marginBottom: 16 }}
          >
            Incorrect PIN. Default is 1234
          </p>
        )}

        {/* Keypad */}
        <div style={keypadGridStyle}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
            <button
              key={key}
              onClick={() => {
                if (key === 'C') handleClear();
                else if (key === '⌫') setPin((p) => p.slice(0, -1));
                else handleDigit(key);
              }}
              style={keyBtnStyle}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const lockOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: '#090d16',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
  padding: 16,
};

const containerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  padding: '32px 24px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const iconBadgeStyle: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: 16,
  backgroundColor: 'rgba(16, 185, 129, 0.12)',
  border: '1px solid rgba(16, 185, 129, 0.3)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.6rem',
};

const keypadGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 12,
  width: '100%',
};

const keyBtnStyle: React.CSSProperties = {
  height: 56,
  borderRadius: 14,
  background: 'rgba(30, 41, 59, 0.7)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-main)',
  fontSize: '1.3rem',
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
