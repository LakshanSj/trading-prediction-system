import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  LogOut,
  RefreshCw,
  Trash2,
  Activity,
  BarChart2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
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
  const [loginUsername, setLoginUsername] = useState('adminTrading');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Data state
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('logs');
  const [filter, setFilter] = useState('all');
  const [logsLoading, setLogsLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // ── Verify existing token on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    apiFetch(`${API_BASE_URL}/admin/verify`, {
      headers: { Authorization: token }
    })
      .then(r => r.json())
      .then(d => {
        if (d.valid) setIsLoggedIn(true);
        else { sessionStorage.removeItem('admin_token'); setToken(''); }
      })
      .catch(() => { sessionStorage.removeItem('admin_token'); setToken(''); });
  }, []);

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

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchLogs();
    fetchStats();
  }, [isLoggedIn, fetchLogs, fetchStats]);

  useEffect(() => {
    if (isLoggedIn) fetchLogs();
  }, [filter]);

  // ── Login ───────────────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToken(data.token);
        sessionStorage.setItem('admin_token', data.token);
        setIsLoggedIn(true);
      } else {
        setLoginError(data.detail || 'Invalid credentials. Please try again.');
      }
    } catch {
      setLoginError('Cannot connect to backend. Ensure the server is running.');
    } finally {
      setLoginLoading(false);
    }
  };

  // ── Logout ──────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    await apiFetch(`${API_BASE_URL}/admin/logout`, {
      method: 'POST',
      headers: { Authorization: token }
    }).catch(() => {});
    sessionStorage.removeItem('admin_token');
    setToken('');
    setIsLoggedIn(false);
    setLogs([]);
    setStats(null);
  };

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
        <div className="admin-modal admin-login-modal">
          {/* Close button */}
          <button className="admin-close-btn" onClick={onClose}>✕</button>

          <div className="admin-login-header">
            <div className="admin-shield-glow">
              <Shield size={40} />
            </div>
            <h2>Admin Access</h2>
            <p>Restricted to authorised personnel only</p>
          </div>

          <form className="admin-login-form" onSubmit={handleLogin}>
            <div className="admin-field">
              <label><User size={13} /> Username</label>
              <input
                type="text"
                value={loginUsername}
                onChange={e => setLoginUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="admin-field">
              <label><Shield size={13} /> Password</label>
              <div className="password-field-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Enter admin password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="show-pw-btn"
                  onClick={() => setShowPassword(s => !s)}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="admin-error-msg">
                <XCircle size={14} /> {loginError}
              </div>
            )}

            <button type="submit" className="admin-login-btn" disabled={loginLoading}>
              {loginLoading ? <><RefreshCw size={14} className="spin-icon" /> Authenticating...</> : 'Login as Admin'}
            </button>
          </form>

          <p className="admin-hint">
            Default credentials — Username: <code>adminTrading</code> · Password: <code>Admin@Trading2025!</code>
          </p>
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
            <button className="admin-action-btn" onClick={() => { fetchLogs(); fetchStats(); }}>
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="admin-action-btn danger" onClick={handleLogout}>
              <LogOut size={13} /> Logout
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
      </div>
    </div>
  );
}
