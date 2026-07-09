import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  RefreshCw,
  Trash2,
  Activity,
  BarChart2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Terminal,
  TrendingUp,
  Zap,
  Clock,
  User,
  Filter,
  ChevronDown,
  Server,
  Database
} from 'lucide-react';

import { dbService } from './firebase';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

const apiFetch = (url, options = {}) => {
  const headers = { ...options.headers, 'ngrok-skip-browser-warning': 'true' };
  return fetch(url, { ...options, headers });
};

// ── Event type → display config ──────────────────────────────────────────────
const EVENT_CONFIG = {
  SYSTEM_START:     { label: 'System Start',      color: '#4facfe', icon: '🚀' },
  ADMIN_LOGIN:      { label: 'Admin Login',        color: '#00e676', icon: '🔓' },
  ADMIN_LOGIN_FAIL: { label: 'Login Failed',       color: '#ff1744', icon: '🚫' },
  ADMIN_LOGOUT:     { label: 'Admin Logout',       color: '#ff9100', icon: '🔒' },
  TRAIN_START:      { label: 'Training Started',   color: '#4facfe', icon: '🔄' },
  TRAIN_COMPLETE:   { label: 'Training Complete',  color: '#00e676', icon: '✅' },
  TRAIN_FAILED:     { label: 'Training Failed',    color: '#ff1744', icon: '❌' },
  PREDICT_FETCH:    { label: 'Prediction Fetch',   color: '#00f2fe', icon: '🔮' },
  EXPLAIN_FETCH:    { label: 'Explainability',     color: '#a78bfa', icon: '💡' },
  WFV_RUN:          { label: 'Walk-Forward Val.',  color: '#ffb74d', icon: '📊' },
  MONITOR_RUN:      { label: 'Monitor Run',        color: '#81c784', icon: '🚨' },
  LOGS_CLEARED:     { label: 'Logs Cleared',       color: '#ff9100', icon: '🗑️' },
  TICKER_STATUS:    { label: 'Ticker Status',      color: '#8fa0c2', icon: '📡' },
};

const getEventCfg = (type) =>
  EVENT_CONFIG[type] || { label: type, color: '#8fa0c2', icon: '📌' };

// ── Filter options ────────────────────────────────────────────────────────────
const FILTER_OPTIONS = [
  { value: 'all',     label: 'All Events' },
  { value: 'TRAIN',   label: 'Training Events' },
  { value: 'ADMIN',   label: 'Admin Events' },
  { value: 'PREDICT', label: 'Predictions' },
  { value: 'MONITOR', label: 'Monitoring' },
  { value: 'WFV',     label: 'Walk-Forward' },
  { value: 'SYSTEM',  label: 'System' },
];

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color, subtitle }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-icon" style={{ color }}>
        <Icon size={20} />
      </div>
      <div className="admin-stat-body">
        <span className="admin-stat-value" style={{ color }}>{value ?? '—'}</span>
        <span className="admin-stat-label">{label}</span>
        {subtitle && <span className="admin-stat-sub">{subtitle}</span>}
      </div>
    </div>
  );
}

// ── Log row ───────────────────────────────────────────────────────────────────
function LogRow({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getEventCfg(entry.event_type);

  return (
    <div className={`log-row ${!entry.success ? 'log-row-error' : ''}`}>
      <div className="log-row-main" onClick={() => setExpanded(e => !e)}>
        <span className="log-event-icon">{cfg.icon}</span>
        <span className="log-event-type" style={{ color: cfg.color }}>{cfg.label}</span>
        <span className="log-timestamp">{entry.timestamp_local}</span>
        {entry.details?.ticker && (
          <span className="log-ticker-tag">{entry.details.ticker}</span>
        )}
        {!entry.success && (
          <span className="log-fail-badge">FAILED</span>
        )}
        <span className="log-ip">{entry.ip_address}</span>
        <ChevronDown
          size={14}
          className={`log-chevron ${expanded ? 'rotated' : ''}`}
        />
      </div>
      {expanded && (
        <div className="log-row-details">
          <pre className="log-details-json">
            {JSON.stringify(entry.details, null, 2)}
          </pre>
          <div className="log-meta-row">
            <span>ID: <code>{entry.id}</code></span>
            <span>UTC: <code>{entry.timestamp}</code></span>
            <span>User: <code>{entry.user}</code></span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main AdminPanel component ─────────────────────────────────────────────────
export default function AdminPanel({ onClose }) {
  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(() => sessionStorage.getItem('admin_token') || '');
  const [loginError, setLoginError] = useState('');

  // Data state
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [userList, setUserList] = useState([]);
  const [activeTab, setActiveTab] = useState('logs');
  const [filter, setFilter] = useState('all');
  const [logsLoading, setLogsLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [userListLoading, setUserListLoading] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // ── Auto-Login to Backend ──────────────────────────────────────────────────
  const performAutoLogin = useCallback(async () => {
    setLoginError('');
    try {
      const res = await apiFetch(`${API_BASE_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'adminTrading', password: 'Admin@Trading2025!' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToken(data.token);
        sessionStorage.setItem('admin_token', data.token);
        setIsLoggedIn(true);
      } else {
        setLoginError(data.detail || 'Authorization failed. Credentials might have changed.');
      }
    } catch {
      setLoginError('Cannot connect to backend. Ensure the python server is running.');
    }
  }, []);

  // ── Verify existing token or trigger auto-login on mount ───────────────────
  useEffect(() => {
    if (token) {
      apiFetch(`${API_BASE_URL}/admin/verify`, {
        headers: { Authorization: token }
      })
        .then(r => r.json())
        .then(d => {
          if (d.valid) {
            setIsLoggedIn(true);
          } else {
            sessionStorage.removeItem('admin_token');
            setToken('');
            performAutoLogin();
          }
        })
        .catch(() => {
          sessionStorage.removeItem('admin_token');
          setToken('');
          performAutoLogin();
        });
    } else {
      performAutoLogin();
    }
  }, [token, performAutoLogin]);

  // ── Fetch logs ──────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async () => {
    if (!token) return;
    setLogsLoading(true);
    try {
      const res = await apiFetch(
        `${API_BASE_URL}/admin/logs?limit=300&event_type=${filter}`,
        { headers: { Authorization: token } }
      );
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [token, filter]);

  // ── Fetch stats ─────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!token) return;
    setStatsLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/admin/stats`, {
        headers: { Authorization: token }
      });
      const data = await res.json();
      setStats(data.stats || null);
    } catch {
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, [token]);

  // ── Fetch user lists ────────────────────────────────────────────────────────
  const fetchUserLists = useCallback(async () => {
    setUserListLoading(true);
    try {
      const statusParam = activeTab === 'pending_users' ? 'pending' : 'approved';
      const list = await dbService.fetchUsers(statusParam);
      list.sort((a, b) => a.username.localeCompare(b.username));
      setUserList(list);
    } catch (err) {
      console.error("Failed to load users:", err);
      setUserList([]);
    } finally {
      setUserListLoading(false);
    }
  }, [activeTab]);

  const handleUpdateStatus = async (username, newStatus) => {
    const success = await dbService.updateUserStatus(username, newStatus);
    if (success) {
      setStatusMsg(`✅ Access status for "${username}" set to ${newStatus}.`);
      setTimeout(() => setStatusMsg(''), 4000);
      fetchUserLists();
    } else {
      setStatusMsg(`❌ Failed to update access status for "${username}".`);
      setTimeout(() => setStatusMsg(''), 4000);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    if (activeTab === 'logs') {
      fetchLogs();
    } else if (activeTab === 'stats') {
      fetchStats();
    } else if (activeTab === 'pending_users' || activeTab === 'approved_users') {
      fetchUserLists();
    }
  }, [isLoggedIn, activeTab, fetchLogs, fetchStats, fetchUserLists]);

  useEffect(() => {
    if (isLoggedIn && activeTab === 'logs') fetchLogs();
  }, [filter, activeTab, isLoggedIn, fetchLogs]);

  // ── Clear logs ──────────────────────────────────────────────────────────────
  const handleClearLogs = async () => {
    if (!clearConfirm) { setClearConfirm(true); return; }
    try {
      const res = await apiFetch(`${API_BASE_URL}/admin/logs/clear`, {
        method: 'DELETE',
        headers: { Authorization: token }
      });
      const data = await res.json();
      setStatusMsg(`✅ Cleared ${data.cleared_entries} log entries.`);
      setClearConfirm(false);
      setTimeout(() => setStatusMsg(''), 4000);
      fetchLogs();
      fetchStats();
    } catch {
      setStatusMsg('❌ Failed to clear logs.');
    }
  };

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="admin-overlay">
        <div className="admin-modal admin-login-modal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '220px', padding: '30px' }}>
          <button className="admin-close-btn" onClick={onClose}>✕</button>
          
          {loginError ? (
            <div style={{ textAlign: 'center' }}>
              <AlertTriangle size={36} style={{ color: '#ff1744', marginBottom: '15px' }} />
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#fff' }}>Connection Failed</h3>
              <p style={{ color: '#8a909d', fontSize: '13px', margin: '0 0 15px 0' }}>{loginError}</p>
              <button 
                onClick={performAutoLogin} 
                className="admin-login-btn" 
                style={{ width: 'auto', display: 'inline-block', padding: '6px 20px', fontSize: '13px' }}
              >
                Retry Authorization
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <RefreshCw size={36} className="spin-icon" style={{ color: '#00f2fe', marginBottom: '15px' }} />
              <h3 style={{ margin: '0 0 10px 0', fontSize: '18px', color: '#fff' }}>Connecting to Admin Panel...</h3>
              <p style={{ color: '#8a909d', fontSize: '13px', margin: '0' }}>Establishing secure backend authorization</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Authenticated Dashboard ───────────────────────────────────────────────
  return (
    <div className="admin-overlay">
      <div className="admin-modal admin-dashboard-modal">
        {/* Header */}
        <div className="admin-dash-header">
          <div className="admin-dash-title">
            <Shield size={18} style={{ color: '#00f2fe' }} />
            <span>Admin Logging Dashboard</span>
            <span className="admin-username-badge">
              <User size={11} /> adminTrading
            </span>
          </div>
          <div className="admin-dash-actions">
            <button className="admin-action-btn" onClick={() => {
              if (activeTab === 'pending_users' || activeTab === 'approved_users') {
                fetchUserLists();
              } else {
                fetchLogs();
                fetchStats();
              }
            }}>
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="admin-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="admin-tab-nav">
          <button
            className={`admin-tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <Terminal size={13} /> Activity Logs
          </button>
          <button
            className={`admin-tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            <BarChart2 size={13} /> System Statistics
          </button>
          <button
            className={`admin-tab-btn ${activeTab === 'pending_users' ? 'active' : ''}`}
            onClick={() => setActiveTab('pending_users')}
          >
            <User size={13} style={{ color: '#ffd600' }} /> Pending Access
          </button>
          <button
            className={`admin-tab-btn ${activeTab === 'approved_users' ? 'active' : ''}`}
            onClick={() => setActiveTab('approved_users')}
          >
            <CheckCircle size={13} style={{ color: '#00e676' }} /> Approved Access
          </button>
        </div>

        {/* ── Logs Tab ── */}
        {activeTab === 'logs' && (
          <div className="admin-tab-content">
            {/* Controls */}
            <div className="admin-log-controls">
              <div className="admin-filter-group">
                <Filter size={13} />
                <select
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  className="admin-filter-select"
                >
                  {FILTER_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div className="admin-log-meta">
                <span>{logs.length} entries</span>
                {statusMsg && <span className="admin-status-msg">{statusMsg}</span>}
              </div>

              <button
                className={`admin-action-btn ${clearConfirm ? 'danger flashing' : 'danger-outline'}`}
                onClick={handleClearLogs}
              >
                <Trash2 size={13} />
                {clearConfirm ? 'Confirm Clear?' : 'Clear Logs'}
              </button>
              {clearConfirm && (
                <button
                  className="admin-action-btn"
                  onClick={() => setClearConfirm(false)}
                >
                  Cancel
                </button>
              )}
            </div>

            {/* Log list */}
            <div className="admin-log-list">
              {logsLoading ? (
                <div className="admin-loading">
                  <RefreshCw size={20} className="spin-icon" />
                  <span>Loading activity logs…</span>
                </div>
              ) : logs.length === 0 ? (
                <div className="admin-empty">
                  <Database size={32} />
                  <p>No log entries found for this filter.</p>
                </div>
              ) : (
                logs.map(entry => <LogRow key={entry.id} entry={entry} />)
              )}
            </div>
          </div>
        )}

        {/* ── Stats Tab ── */}
        {activeTab === 'stats' && (
          <div className="admin-tab-content">
            {statsLoading ? (
              <div className="admin-loading">
                <RefreshCw size={20} className="spin-icon" />
                <span>Computing statistics…</span>
              </div>
            ) : stats ? (
              <>
                <div className="admin-stats-grid">
                  <StatCard icon={Zap}        label="Total Events"         value={stats.total_events}        color="#4facfe" />
                  <StatCard icon={TrendingUp} label="Training Runs"        value={stats.training_runs}       color="#00f2fe" />
                  <StatCard icon={CheckCircle} label="Successful Trainings" value={stats.successful_trainings} color="#00e676" />
                  <StatCard icon={XCircle}    label="Failed Trainings"     value={stats.failed_trainings}    color="#ff1744" />
                  <StatCard icon={Activity}   label="Prediction Fetches"   value={stats.prediction_fetches}  color="#a78bfa" />
                  <StatCard icon={BarChart2}  label="WFV Runs"             value={stats.wfv_runs}            color="#ffb74d" />
                  <StatCard icon={Server}     label="Monitor Runs"         value={stats.monitor_runs}        color="#81c784" />
                  <StatCard icon={Shield}     label="Admin Logins"         value={stats.admin_logins}        color="#00e676" />
                  <StatCard icon={AlertTriangle} label="Failed Logins"     value={stats.failed_logins}       color="#ff9100" />
                </div>

                <div className="admin-stats-meta">
                  {stats.last_event && (
                    <div className="admin-meta-row">
                      <Clock size={13} /> Latest event: <strong>{stats.last_event}</strong>
                    </div>
                  )}
                  {stats.first_event && (
                    <div className="admin-meta-row">
                      <Clock size={13} /> Earliest event: <strong>{stats.first_event}</strong>
                    </div>
                  )}
                  {stats.unique_tickers?.length > 0 && (
                    <div className="admin-meta-row">
                      <TrendingUp size={13} /> Active tickers:&nbsp;
                      {stats.unique_tickers.map(t => (
                        <span key={t} className="admin-ticker-pill">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="admin-empty">
                <BarChart2 size={32} />
                <p>No statistics available yet.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Pending Users Tab ── */}
        {activeTab === 'pending_users' && (
          <div className="admin-tab-content">
            <div className="panel-desc" style={{ marginBottom: '15px' }}>
              <h4 style={{ margin: '0 0 5px 0', fontSize: '15px', color: '#ffd600' }}>Pending Access Requests</h4>
              <p style={{ margin: 0, color: '#8a909d', fontSize: '12px' }}>
                Accounts listed below have registered but are currently blocked from entering the system. Click "Approve Access" to authorize them.
              </p>
            </div>

            {statusMsg && <div className="admin-status-msg" style={{ marginBottom: '10px' }}>{statusMsg}</div>}
            
            {userListLoading ? (
              <div className="admin-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px', color: '#8a909d', gap: '8px' }}>
                <RefreshCw size={18} className="spin-icon" />
                <span>Loading users list...</span>
              </div>
            ) : userList.length === 0 ? (
              <div className="admin-empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px', background: '#131722', border: '1px dashed #2a2e39', borderRadius: '8px', color: '#8a909d', gap: '10px' }}>
                <CheckCircle size={24} style={{ color: '#00e676' }} />
                <span>No pending registrations found. All users have access.</span>
              </div>
            ) : (
              <div className="admin-table-wrapper" style={{ border: '1px solid #2a2e39', borderRadius: '8px', background: '#131722', overflow: 'hidden' }}>
                <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#1c2030', color: '#8a909d', borderBottom: '1px solid #2a2e39' }}>
                      <th style={{ padding: '10px 15px', fontWeight: '600' }}>Username</th>
                      <th style={{ padding: '10px 15px', fontWeight: '600' }}>Email Address</th>
                      <th style={{ padding: '10px 15px', fontWeight: '600' }}>Registration Date</th>
                      <th style={{ padding: '10px 15px', fontWeight: '600', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userList.map(user => (
                      <tr key={user.uid} style={{ borderBottom: '1px solid #2a2e39' }}>
                        <td style={{ padding: '10px 15px', color: '#fff', fontWeight: '600' }}>{user.username}</td>
                        <td style={{ padding: '10px 15px', color: '#b9bec7' }}>{user.email}</td>
                        <td style={{ padding: '10px 15px', color: '#8a909d', fontSize: '12px' }}>
                          {user.created_at ? new Date(user.created_at).toLocaleString() : 'N/A'}
                        </td>
                        <td style={{ padding: '10px 15px', textAlign: 'right' }}>
                          <button 
                            className="action-btn-green"
                            onClick={() => handleUpdateStatus(user.username, 'approved')}
                            style={{ background: 'rgba(0, 230, 118, 0.1)', color: '#00e676', border: '1px solid rgba(0, 230, 118, 0.3)', padding: '5px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s' }}
                          >
                            Approve Access
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Approved Users Tab ── */}
        {activeTab === 'approved_users' && (
          <div className="admin-tab-content">
            <div className="panel-desc" style={{ marginBottom: '15px' }}>
              <h4 style={{ margin: '0 0 5px 0', fontSize: '15px', color: '#00e676' }}>Approved Access Accounts</h4>
              <p style={{ margin: 0, color: '#8a909d', fontSize: '12px' }}>
                These users currently have full authorization to access the dashboards. Click "Revoke Access" to move them back to the pending list.
              </p>
            </div>

            {statusMsg && <div className="admin-status-msg" style={{ marginBottom: '10px' }}>{statusMsg}</div>}
            
            {userListLoading ? (
              <div className="admin-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px', color: '#8a909d', gap: '8px' }}>
                <RefreshCw size={18} className="spin-icon" />
                <span>Loading users list...</span>
              </div>
            ) : userList.filter(u => u.username !== 'adminTrading').length === 0 ? (
              <div className="admin-empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px', background: '#131722', border: '1px dashed #2a2e39', borderRadius: '8px', color: '#8a909d', gap: '10px' }}>
                <AlertTriangle size={24} style={{ color: '#ff9100' }} />
                <span>No guest accounts are currently approved. Only adminTrading has active dashboard access.</span>
              </div>
            ) : (
              <div className="admin-table-wrapper" style={{ border: '1px solid #2a2e39', borderRadius: '8px', background: '#131722', overflow: 'hidden' }}>
                <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#1c2030', color: '#8a909d', borderBottom: '1px solid #2a2e39' }}>
                      <th style={{ padding: '10px 15px', fontWeight: '600' }}>Username</th>
                      <th style={{ padding: '10px 15px', fontWeight: '600' }}>Email Address</th>
                      <th style={{ padding: '10px 15px', fontWeight: '600' }}>Registration Date</th>
                      <th style={{ padding: '10px 15px', fontWeight: '600', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userList.filter(u => u.username !== 'adminTrading').map(user => (
                      <tr key={user.uid} style={{ borderBottom: '1px solid #2a2e39' }}>
                        <td style={{ padding: '10px 15px', color: '#fff', fontWeight: '600' }}>{user.username}</td>
                        <td style={{ padding: '10px 15px', color: '#b9bec7' }}>{user.email}</td>
                        <td style={{ padding: '10px 15px', color: '#8a909d', fontSize: '12px' }}>
                          {user.created_at ? new Date(user.created_at).toLocaleString() : 'N/A'}
                        </td>
                        <td style={{ padding: '10px 15px', textAlign: 'right' }}>
                          <button 
                            className="action-btn-red"
                            onClick={() => handleUpdateStatus(user.username, 'pending')}
                            style={{ background: 'rgba(242, 54, 69, 0.1)', color: '#ff5252', border: '1px solid rgba(242, 54, 69, 0.3)', padding: '5px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s' }}
                          >
                            Revoke Access (Pending)
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
