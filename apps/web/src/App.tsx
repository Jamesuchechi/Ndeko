import React, { useState } from 'react';
import { useNdeko } from './context/NdekoContext';
import { PosView } from './views/PosView';
import { InventoryView } from './views/InventoryView';
import { CustomersView } from './views/CustomersView';
import { ReconciliationView } from './views/ReconciliationView';
import { ReportsView } from './views/ReportsView';
import { SalesHistoryView } from './views/SalesHistoryView';
import { SettingsView } from './views/SettingsView';
import { PinLockScreen } from './components/PinLockScreen';

type Tab = 'pos' | 'inventory' | 'customers' | 'reconciliation' | 'reports' | 'sales' | 'settings';

export const App: React.FC = () => {
  const {
    isReady,
    isLocked,
    config,
    pendingCount,
    negativeStockAlerts,
    isOnline,
    lockTill,
    syncState,
    syncNow,
    dismissDriftWarning,
  } = useNdeko();
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
            🛒 POS
          </button>
          <button
            onClick={() => setActiveTab('inventory')}
            style={{ ...tabBtnStyle, ...(activeTab === 'inventory' ? activeTabStyle : {}) }}
          >
            📦 Inventory
          </button>
          <button
            onClick={() => setActiveTab('customers')}
            style={{ ...tabBtnStyle, ...(activeTab === 'customers' ? activeTabStyle : {}) }}
          >
            🤝 Customers
          </button>
          <button
            onClick={() => setActiveTab('reconciliation')}
            style={{ ...tabBtnStyle, ...(activeTab === 'reconciliation' ? activeTabStyle : {}) }}
          >
            ⚖️ Reconciliation
            {negativeStockAlerts.length > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: 'var(--accent-rose)',
                  color: '#ffffff',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                }}
              >
                {negativeStockAlerts.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            style={{ ...tabBtnStyle, ...(activeTab === 'reports' ? activeTabStyle : {}) }}
          >
            📊 Reports
          </button>
          <button
            onClick={() => setActiveTab('sales')}
            style={{ ...tabBtnStyle, ...(activeTab === 'sales' ? activeTabStyle : {}) }}
          >
            📜 History
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
          <button
            onClick={() => syncNow()}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
            }}
            title="Click to trigger cloud sync now"
          >
            <span
              className={`badge ${
                syncState.status === 'syncing'
                  ? 'badge-cyan'
                  : syncState.status === 'error'
                    ? 'badge-rose'
                    : pendingCount > 0
                      ? 'badge-amber'
                      : 'badge-emerald'
              }`}
            >
              {syncState.status === 'syncing'
                ? '🔄 Syncing...'
                : syncState.status === 'error'
                  ? '⚠️ Sync Error'
                  : !isOnline
                    ? `⚡ Offline (${pendingCount})`
                    : pendingCount > 0
                      ? `⏳ ${pendingCount} pending`
                      : '✓ Synced'}
            </span>
          </button>

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

      {/* Clock Drift Warning Banner */}
      {syncState.driftWarning && (
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.15)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.4)',
            color: '#fbbf24',
            padding: '8px 20px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚠️</span>
            <span>
              <strong>Clock Drift Warning:</strong> Remote events detected from a device with its
              clock set far into the future. Local event causality is protected by HLC drift
              clamping, but please verify till system time.
            </span>
          </div>
          <button
            onClick={dismissDriftWarning}
            style={{
              background: 'transparent',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              color: '#fbbf24',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main View Container */}
      <main style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'pos' && <PosView />}
        {activeTab === 'inventory' && <InventoryView />}
        {activeTab === 'customers' && <CustomersView />}
        {activeTab === 'reconciliation' && <ReconciliationView />}
        {activeTab === 'reports' && <ReportsView />}
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
