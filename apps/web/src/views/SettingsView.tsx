import React, { useState, useEffect } from 'react';
import { useNdeko } from '../context/NdekoContext';

export const SettingsView: React.FC = () => {
  const {
    config,
    pendingCount,
    totalEventCount,
    isOnline,
    lockTill,
    setTillPin,
    exportBackup,
    importBackup,
  } = useNdeko();

  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinSuccess, setPinSuccess] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    if ('storage' in navigator && 'persisted' in navigator.storage) {
      navigator.storage
        .persisted()
        .then(setIsPersisted)
        .catch(() => {});
    }
  }, []);

  const handleSetPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.length === 4 && /^\d+$/.test(pinInput)) {
      setTillPin(pinInput);
      setPinSuccess(true);
      setPinInput('');
      setTimeout(() => setPinSuccess(false), 3000);
    } else {
      alert('PIN must be exactly 4 digits');
    }
  };

  const handleExportBackup = async () => {
    const jsonStr = await exportBackup();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ndeko-backup-${config.branchCode}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const res = await importBackup(text);
      setImportStatus(
        `Successfully restored! ${res.imported} new event(s) applied to projections.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setImportStatus(`Import failed: ${msg}`);
    }
  };

  const requestPersistence = async () => {
    if ('storage' in navigator && 'persist' in navigator.storage) {
      const granted = await navigator.storage.persist();
      setIsPersisted(granted);
      alert(granted ? 'Storage persistence granted by browser.' : 'Browser denied persistence.');
    }
  };

  return (
    <div style={containerStyle}>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Settings & Diagnostics</h2>

      <div style={gridStyle}>
        {/* Device & Architecture Info */}
        <div style={cardStyle} className="glass-panel">
          <div style={cardHeaderStyle}>
            <span style={{ fontSize: '1.2rem' }}>📱</span>
            <h3 style={cardTitleStyle}>Device & Terminal Registration</h3>
          </div>
          <div style={infoListStyle}>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Branch Code</span>
              <span style={valueStyle}>
                {config.branchCode} ({config.branchId})
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Till / Device</span>
              <span style={valueStyle}>
                {config.deviceCode} ({config.deviceId})
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Organization</span>
              <span style={valueStyle}>{config.orgId}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Local Event Sequence</span>
              <span style={{ ...valueStyle, color: '#38bdf8' }}>#{config.receiptCounter}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Store Engine</span>
              <span style={valueStyle}>IndexedDB (Dexie 4.0)</span>
            </div>
          </div>
        </div>

        {/* Sync & Offline Status */}
        <div style={cardStyle} className="glass-panel">
          <div style={cardHeaderStyle}>
            <span style={{ fontSize: '1.2rem' }}>⚡</span>
            <h3 style={cardTitleStyle}>Sync & Platform Telemetry</h3>
          </div>
          <div style={infoListStyle}>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Network Connectivity</span>
              <span className={`badge ${isOnline ? 'badge-emerald' : 'badge-amber'}`}>
                {isOnline ? '● Online' : '○ Offline Ready'}
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Pending Unsynced Events</span>
              <span style={{ ...valueStyle, color: pendingCount > 0 ? '#f59e0b' : '#34d399' }}>
                {pendingCount} pending
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Total Stored Events</span>
              <span style={valueStyle}>{totalEventCount} events</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Persistent Storage (OPFS/IDB)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`badge ${isPersisted ? 'badge-emerald' : 'badge-amber'}`}>
                  {isPersisted ? 'Protected' : 'Standard'}
                </span>
                {!isPersisted && (
                  <button
                    onClick={requestPersistence}
                    className="btn-secondary"
                    style={smallBtnStyle}
                  >
                    Protect Storage
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Backup and Restore */}
        <div style={cardStyle} className="glass-panel">
          <div style={cardHeaderStyle}>
            <span style={{ fontSize: '1.2rem' }}>💾</span>
            <h3 style={cardTitleStyle}>Backup & Restore</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Export the complete, immutable event log. You can restore this backup file on any device
            to reproduce the exact identical state.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={handleExportBackup} className="glow-btn" style={actionBtnStyle}>
              📥 Export JSON Backup
            </button>
            <label
              className="btn-secondary"
              style={{
                ...actionBtnStyle,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              📤 Restore from Backup
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                style={{ display: 'none' }}
              />
            </label>
          </div>
          {importStatus && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 8,
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                fontSize: '0.8rem',
                color: '#38bdf8',
              }}
            >
              {importStatus}
            </div>
          )}
        </div>

        {/* Till Security & PIN */}
        <div style={cardStyle} className="glass-panel">
          <div style={cardHeaderStyle}>
            <span style={{ fontSize: '1.2rem' }}>🔐</span>
            <h3 style={cardTitleStyle}>Till Security & Lock</h3>
          </div>
          <form onSubmit={handleSetPin} style={{ marginBottom: 16 }}>
            <label style={formLabelStyle}>Configure 4-Digit Till PIN (Default: 1234)</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <input
                type="password"
                maxLength={4}
                placeholder="New 4-digit PIN"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                style={pinInputStyle}
                className="mono"
              />
              <button type="submit" className="btn-secondary" style={actionBtnStyle}>
                Update PIN
              </button>
            </div>
            {pinSuccess && (
              <p style={{ color: '#34d399', fontSize: '0.8rem', marginTop: 6 }}>
                PIN successfully updated!
              </p>
            )}
          </form>

          <button
            onClick={lockTill}
            className="btn-danger"
            style={{ ...actionBtnStyle, width: '100%' }}
          >
            🔒 Lock Till Now
          </button>
        </div>
      </div>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  gap: 20,
};

const cardStyle: React.CSSProperties = {
  padding: 24,
  display: 'flex',
  flexDirection: 'column',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 16,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 700,
};

const infoListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingBottom: 8,
  borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
};

const valueStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 600,
  fontFamily: 'var(--font-mono)',
};

const formLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

const pinInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 8,
  background: 'var(--bg-input)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-main)',
  fontSize: '0.9rem',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: 10,
  fontSize: '0.85rem',
  fontWeight: 600,
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: '0.7rem',
};
