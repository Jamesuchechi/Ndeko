import React, { useState, useMemo } from 'react';
import { formatNaira } from '@ndeko/core';
import { toCsv, type CustomerView, type CustomerTransaction } from '@ndeko/projections';
import { useNdeko } from '../context/NdekoContext';

export const CustomersView: React.FC = () => {
  const { customers, createOrUpdateCustomer, recordPayment, getCustomerStatement } = useNdeko();

  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerView | null>(null);

  // Modals
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isStatementModalOpen, setIsStatementModalOpen] = useState(false);

  // Forms
  const [customerForm, setCustomerForm] = useState({
    id: '',
    name: '',
    phone: '',
    creditLimitNaira: '',
  });

  const [paymentForm, setPaymentForm] = useState<{
    amountNaira: string;
    method: 'CASH' | 'TRANSFER' | 'CARD';
    note: string;
  }>({
    amountNaira: '',
    method: 'CASH',
    note: '',
  });

  const [statementTxns, setStatementTxns] = useState<CustomerTransaction[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtered
  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q),
    );
  }, [customers, search]);

  // Aggregate stats
  const stats = useMemo(() => {
    let totalDebtKobo = 0;
    let totalCreditLineKobo = 0;
    let debtorCount = 0;

    for (const c of customers) {
      if (c.balanceKobo > 0) {
        totalDebtKobo += c.balanceKobo;
        debtorCount++;
      }
      totalCreditLineKobo += c.creditLimitKobo;
    }

    return {
      totalDebtKobo,
      totalCreditLineKobo,
      debtorCount,
      totalCount: customers.length,
    };
  }, [customers]);

  const handleOpenAdd = () => {
    setCustomerForm({ id: '', name: '', phone: '', creditLimitNaira: '0' });
    setErrorMsg(null);
    setIsCustomerModalOpen(true);
  };

  const handleOpenEdit = (c: CustomerView) => {
    setCustomerForm({
      id: c.id,
      name: c.name,
      phone: c.phone,
      creditLimitNaira: (c.creditLimitKobo / 100).toString(),
    });
    setErrorMsg(null);
    setIsCustomerModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name.trim()) {
      setErrorMsg('Customer name is required');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const creditLimitKobo = Math.max(
        0,
        Math.round(parseFloat(customerForm.creditLimitNaira || '0') * 100),
      );
      await createOrUpdateCustomer({
        customerId: customerForm.id || undefined,
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim() || undefined,
        creditLimitKobo,
      });
      setIsCustomerModalOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error saving customer');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenPayment = (c: CustomerView) => {
    setSelectedCustomer(c);
    setPaymentForm({
      amountNaira: c.balanceKobo > 0 ? (c.balanceKobo / 100).toString() : '',
      method: 'CASH',
      note: '',
    });
    setErrorMsg(null);
    setIsPaymentModalOpen(true);
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const amountKobo = Math.round(parseFloat(paymentForm.amountNaira || '0') * 100);
    if (amountKobo <= 0) {
      setErrorMsg('Payment amount must be greater than zero');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await recordPayment(
        selectedCustomer.id,
        amountKobo,
        paymentForm.method,
        paymentForm.note.trim() || undefined,
      );
      setIsPaymentModalOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error recording payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenStatement = (c: CustomerView) => {
    setSelectedCustomer(c);
    const txns = getCustomerStatement(c.id);
    setStatementTxns(txns);
    setIsStatementModalOpen(true);
  };

  const handleDownloadStatementCsv = () => {
    if (!selectedCustomer) return;
    const rows = statementTxns.map((t) => ({
      'Date & Time': new Date(t.createdAt).toLocaleString('en-NG'),
      'Transaction Type': t.type,
      'Reference ID': t.refId,
      'Amount (Kobo)': t.amountKobo,
      'Amount (Naira)': (t.amountKobo / 100).toFixed(2),
      Note: t.note || '',
    }));

    const csvContent = toCsv(rows);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statement_${selectedCustomer.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={containerStyle}>
      {/* Header and Summary stats */}
      <div style={headerSectionStyle}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Customers & Credit Ledger</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Customer profiles, credit limits, debt tracking and repayments.
          </p>
        </div>

        <button onClick={handleOpenAdd} className="glow-btn" style={addBtnStyle}>
          + New Customer
        </button>
      </div>

      {/* KPI Cards */}
      <div style={kpiGridStyle}>
        <div style={kpiCardStyle} className="glass-panel">
          <span style={kpiLabelStyle}>Total Outstanding Credit</span>
          <div style={{ ...kpiValueStyle, color: stats.totalDebtKobo > 0 ? '#f43f5e' : '#10b981' }}>
            {formatNaira(stats.totalDebtKobo)}
          </div>
          <span style={kpiSubtextStyle}>{stats.debtorCount} customers with active balance</span>
        </div>

        <div style={kpiCardStyle} className="glass-panel">
          <span style={kpiLabelStyle}>Total Credit Line</span>
          <div style={{ ...kpiValueStyle, color: 'var(--accent-cyan)' }}>
            {formatNaira(stats.totalCreditLineKobo)}
          </div>
          <span style={kpiSubtextStyle}>Assigned across all customers</span>
        </div>

        <div style={kpiCardStyle} className="glass-panel">
          <span style={kpiLabelStyle}>Active Directory</span>
          <div style={kpiValueStyle}>{stats.totalCount}</div>
          <span style={kpiSubtextStyle}>Registered customers</span>
        </div>
      </div>

      {/* Search Bar */}
      <div style={searchBarStyle} className="glass-panel">
        <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>🔍</span>
        <input
          type="text"
          placeholder="Search by customer name or phone number..."
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

      {/* Customer Directory Table */}
      <div style={tableCardStyle} className="glass-panel">
        <table style={tableStyle}>
          <thead>
            <tr style={tableHeadRowStyle}>
              <th style={thStyle}>Customer</th>
              <th style={thStyle}>Phone</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Credit Limit</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Current Balance</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Available Credit</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCustomers.map((c) => (
              <tr key={c.id} style={tableRowStyle}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>{c.name}</div>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: 'var(--text-dim)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    ID: {c.id.slice(0, 12)}...
                  </div>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: c.phone ? 'var(--text-muted)' : 'var(--text-dim)' }}>
                    {c.phone || '—'}
                  </span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
                  {formatNaira(c.creditLimitKobo)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 800 }}>
                  <span style={{ color: c.balanceKobo > 0 ? '#f43f5e' : '#10b981' }}>
                    {formatNaira(c.balanceKobo)}
                  </span>
                </td>
                <td
                  style={{
                    ...tdStyle,
                    textAlign: 'right',
                    fontWeight: 600,
                    color: 'var(--accent-cyan)',
                  }}
                >
                  {formatNaira(c.availableCreditKobo)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {c.isOverLimit ? (
                    <span className="badge badge-rose">⚠️ Over Limit</span>
                  ) : c.balanceKobo > 0 ? (
                    <span className="badge badge-amber">Owing</span>
                  ) : (
                    <span className="badge badge-emerald">Clear</span>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => handleOpenPayment(c)}
                      className="glow-btn"
                      style={smallActionBtnStyle}
                      title="Receive repayment"
                    >
                      💵 Pay
                    </button>
                    <button
                      onClick={() => handleOpenStatement(c)}
                      className="btn-secondary"
                      style={smallActionBtnStyle}
                      title="View transaction statement"
                    >
                      📜 Statement
                    </button>
                    <button
                      onClick={() => handleOpenEdit(c)}
                      className="btn-secondary"
                      style={smallActionBtnStyle}
                      title="Edit customer"
                    >
                      ✏️ Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredCustomers.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}
                >
                  No customers found. Click "+ New Customer" to register one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Customer Add/Edit Modal */}
      {isCustomerModalOpen && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle} className="glass-panel">
            <div style={modalHeaderStyle}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                {customerForm.id ? 'Edit Customer' : 'Add New Customer'}
              </h3>
              <button onClick={() => setIsCustomerModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>

            {errorMsg && <div style={errorBannerStyle}>⚠️ {errorMsg}</div>}

            <form onSubmit={handleSaveCustomer}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Full Name / Business Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Alh. Bello Kano"
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div style={formGroupStyle}>
                <label style={labelStyle}>Phone Number</label>
                <input
                  type="tel"
                  placeholder="e.g. 0803 123 4567"
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div style={formGroupStyle}>
                <label style={labelStyle}>Credit Limit (₦ Naira)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 50000"
                  value={customerForm.creditLimitNaira}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, creditLimitNaira: e.target.value })
                  }
                  style={inputStyle}
                />
                <span style={helpTextStyle}>Set to 0 if credit is not permitted.</span>
              </div>

              <div style={modalActionsStyle}>
                <button
                  type="button"
                  onClick={() => setIsCustomerModalOpen(false)}
                  className="btn-secondary"
                  style={btnStyle}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="glow-btn" style={btnStyle}>
                  {isSubmitting ? 'Saving...' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive Payment Modal */}
      {isPaymentModalOpen && selectedCustomer && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle} className="glass-panel">
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Receive Customer Repayment</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Customer:{' '}
                  <strong style={{ color: 'var(--text-main)' }}>{selectedCustomer.name}</strong>
                </p>
              </div>
              <button onClick={() => setIsPaymentModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>

            <div style={currentBalanceBannerStyle}>
              <span>Current Outstanding Balance:</span>
              <strong style={{ fontSize: '1.2rem', color: '#f43f5e' }}>
                {formatNaira(selectedCustomer.balanceKobo)}
              </strong>
            </div>

            {errorMsg && <div style={errorBannerStyle}>⚠️ {errorMsg}</div>}

            <form onSubmit={handleSavePayment}>
              <div style={formGroupStyle}>
                <label style={labelStyle}>Payment Amount (₦ Naira) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  placeholder="e.g. 15000"
                  value={paymentForm.amountNaira}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amountNaira: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div style={formGroupStyle}>
                <label style={labelStyle}>Payment Method *</label>
                <div style={methodBtnGridStyle}>
                  {(['CASH', 'TRANSFER', 'CARD'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentForm({ ...paymentForm, method: m })}
                      style={{
                        ...methodBtnStyle,
                        ...(paymentForm.method === m ? activeMethodBtnStyle : {}),
                      }}
                    >
                      {m === 'CASH' && '💵 '}
                      {m === 'TRANSFER' && '📱 '}
                      {m === 'CARD' && '💳 '}
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div style={formGroupStyle}>
                <label style={labelStyle}>Note / Reference</label>
                <input
                  type="text"
                  placeholder="e.g. Zenith bank transfer or teller #38194"
                  value={paymentForm.note}
                  onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                  style={inputStyle}
                />
              </div>

              <div style={modalActionsStyle}>
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="btn-secondary"
                  style={btnStyle}
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmitting} className="glow-btn" style={btnStyle}>
                  {isSubmitting ? 'Recording...' : 'Confirm Repayment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statement Modal */}
      {isStatementModalOpen && selectedCustomer && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, maxWidth: 750 }} className="glass-panel">
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Account Statement</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {selectedCustomer.name} • Balance: {formatNaira(selectedCustomer.balanceKobo)}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  onClick={handleDownloadStatementCsv}
                  className="btn-secondary"
                  style={smallActionBtnStyle}
                >
                  📥 Export CSV
                </button>
                <button onClick={() => setIsStatementModalOpen(false)} style={closeBtnStyle}>
                  ✕
                </button>
              </div>
            </div>

            <div style={{ maxHeight: 420, overflowY: 'auto', marginTop: 12 }}>
              <table style={tableStyle}>
                <thead>
                  <tr style={tableHeadRowStyle}>
                    <th style={thStyle}>Date & Time</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Details / Note</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statementTxns.map((t) => (
                    <tr key={t.id} style={tableRowStyle}>
                      <td style={{ ...tdStyle, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {new Date(t.createdAt).toLocaleString('en-NG')}
                      </td>
                      <td style={tdStyle}>
                        <span
                          className={`badge ${
                            t.type === 'CREDIT_SALE'
                              ? 'badge-amber'
                              : t.type === 'PAYMENT'
                                ? 'badge-emerald'
                                : 'badge-cyan'
                          }`}
                        >
                          {t.type}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.85rem' }}>{t.note || '—'}</td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: 'right',
                          fontWeight: 700,
                          color: t.amountKobo > 0 ? '#f43f5e' : '#10b981',
                        }}
                      >
                        {t.amountKobo > 0
                          ? `+${formatNaira(t.amountKobo)}`
                          : formatNaira(t.amountKobo)}
                      </td>
                    </tr>
                  ))}
                  {statementTxns.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}
                      >
                        No transactions recorded for this customer yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button
                onClick={() => setIsStatementModalOpen(false)}
                className="btn-secondary"
                style={btnStyle}
              >
                Close
              </button>
            </div>
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
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 20,
};

const addBtnStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.9rem',
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

const searchBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 18px',
  borderRadius: 'var(--radius-md)',
  marginBottom: 20,
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontSize: '0.95rem',
};

const clearSearchBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-dim)',
  fontSize: '1rem',
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

const smallActionBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.78rem',
  fontWeight: 600,
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

const helpTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  color: 'var(--text-dim)',
  marginTop: 4,
};

const currentBalanceBannerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 16px',
  background: 'rgba(244, 63, 94, 0.1)',
  border: '1px solid rgba(244, 63, 94, 0.25)',
  borderRadius: 'var(--radius-sm)',
  marginBottom: 16,
  fontSize: '0.9rem',
};

const methodBtnGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
};

const methodBtnStyle: React.CSSProperties = {
  padding: '10px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
  fontWeight: 600,
};

const activeMethodBtnStyle: React.CSSProperties = {
  background: 'rgba(16, 185, 129, 0.15)',
  borderColor: 'var(--accent-emerald)',
  color: '#ffffff',
  fontWeight: 700,
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
  padding: '10px 14px',
  background: 'rgba(244, 63, 94, 0.15)',
  border: '1px solid var(--accent-rose)',
  color: '#f43f5e',
  borderRadius: 'var(--radius-sm)',
  fontSize: '0.85rem',
  marginBottom: 16,
};
