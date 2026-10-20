import React, { useState } from 'react';
import { useNdeko } from './context/NdekoContext';
import { PosView } from './views/PosView';
import { InventoryView } from './views/InventoryView';
import { SalesHistoryView } from './views/SalesHistoryView';
import { SettingsView } from './views/SettingsView';
import { PinLockScreen } from './components/PinLockScreen';

type Tab = 'pos' | 'inventory' | 'sales' | 'settings';

export const App: React.FC = () => {
  const { isReady, isLocked, config, pendingCount, isOnline, lockTill } = useNdeko();
  const [activeTab, setActiveTab] = useState<Tab>('pos');

  if (!isReady) {
    return (
      <div style={loadingContainerStyle}>
        <div style={loadingCardStyle} className="glass-panel">
          <img src="/icon.svg" alt="Ndeko" style={{ width: 64, height: 64 }} />
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 12 }}>Ndekọ Shop OS</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Starting local event log & folding projections...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={appContainerStyle}>
      {/* Top Header Bar */}
      <header style={headerStyle} className="glass-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/icon.svg" alt="Ndeko" style={{ width: 34, height: 34, borderRadius: 8 }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <h1 style={logoTextStyle}>NDEKỌ</h1>
              <span style={dotStyle} />
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 600 }}>
              {config.branchCode} • Till {config.deviceCode}
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <nav style={navContainerStyle}>
          <button
            onClick={() => setActiveTab('pos')}
            style={{ ...tabBtnStyle, ...(activeTab === 'pos' ? activeTabStyle : {}) }}
          >
            🛒 POS Register
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            style={{ ...tabBtnStyle, ...(activeTab === 'inventory' ? activeTabStyle : {}) }}
          >
            📦 Inventory & Stock
          </button>
          <button
            onClick={() => setActiveTab('sales')}
            style={{ ...tabBtnStyle, ...(activeTab === 'sales' ? activeTabStyle : {}) }}
          >
            📜 Sales & Cash-Up
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{ ...tabBtnStyle, ...(activeTab === 'settings' ? activeTabStyle : {}) }}
          >
            ⚙️ Settings
          </button>
        </nav>

        {/* Status Indicators and Lock */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className={`badge ${
              pendingCount > 0 ? 'badge-amber' : isOnline ? 'badge-emerald' : 'badge-cyan'
            }`}
            title="Local event log sync status"
          >
            {pendingCount > 0 ? `${pendingCount} pending` : isOnline ? 'Online' : 'Offline Ready'}
          </span>

          <button
            onClick={lockTill}
            className="btn-secondary"
            style={lockBtnStyle}
            title="Lock Till"
          >
            🔒 Lock
          </button>
        </div>
      </header>

      {/* Main View Container */}
      <main style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'pos' && <PosView />}
        {activeTab === 'inventory' && <InventoryView />}
        {activeTab === 'sales' && <SalesHistoryView />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      {/* PIN Lock Screen if locked */}
      {isLocked && <PinLockScreen />}
    </div>
  );
};

const appContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  overflow: 'hidden',
  backgroundColor: 'var(--bg-primary)',
};

const headerStyle: React.CSSProperties = {
  height: 64,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0 24px',
  borderRadius: 0,
  borderBottom: '1px solid var(--border-subtle)',
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: 'none',
  zIndex: 100,
};

const logoTextStyle: React.CSSProperties = {
  fontSize: '1.15rem',
  fontWeight: 900,
  letterSpacing: '0.08em',
  color: '#f8fafc',
};

const dotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  backgroundColor: '#10b981',
  boxShadow: '0 0 8px #10b981',
};

const navContainerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(15, 23, 42, 0.6)',
  padding: 4,
  borderRadius: 12,
  border: '1px solid var(--border-subtle)',
};

const tabBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  background: 'transparent',
  color: 'var(--text-muted)',
  fontSize: '0.85rem',
  fontWeight: 600,
};

const activeTabStyle: React.CSSProperties = {
  background: 'rgba(30, 41, 59, 0.9)',
  color: '#f8fafc',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
};

const lockBtnStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  fontSize: '0.8rem',
};

const loadingContainerStyle: React.CSSProperties = {
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#090d16',
};

const loadingCardStyle: React.CSSProperties = {
  padding: 40,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  maxWidth: 360,
};
