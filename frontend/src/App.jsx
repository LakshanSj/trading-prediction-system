import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Settings, 
  BarChart2, 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  XCircle, 
  RefreshCw, 
  Play, 
  Search, 
  Calendar, 
  HelpCircle,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  ReferenceLine,
  Cell
} from 'recharts';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Helper wrapper to skip ngrok browser warnings programmatically
const apiFetch = (url, options = {}) => {
  const headers = {
    ...options.headers,
    'ngrok-skip-browser-warning': 'true'
  };
  return fetch(url, { ...options, headers });
};

function App() {
  // Input states
  const [ticker, setTicker] = useState('AAPL');
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [startDate, setStartDate] = useState('2015-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [epochs, setEpochs] = useState(15);
  
  // Navigation & UI states
  const [activeTab, setActiveTab] = useState('predictions');
  const [backendStatus, setBackendStatus] = useState('checking');
  
  // Data states
  const [tickerStatus, setTickerStatus] = useState(null); // {status, meta}
  const [predictionData, setPredictionData] = useState(null);
  const [explainData, setExplainData] = useState(null);
  const [wfvData, setWfvData] = useState(null);
  const [monitorData, setMonitorData] = useState(null);
  
  // Loading & logs states
  const [trainLoading, setTrainLoading] = useState(false);
  const [wfvLoading, setWfvLoading] = useState(false);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [generalLoading, setGeneralLoading] = useState(false);
  const [logMessages, setLogMessages] = useState([]);
  
  // Ref for auto-polling ticker status during training
  const pollIntervalRef = useRef(null);

  // Check Backend Connection
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/`);
        if (res.ok) {
          setBackendStatus('connected');
        } else {
          setBackendStatus('disconnected');
        }
      } catch (err) {
        setBackendStatus('disconnected');
      }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Ticker Status & Active Data
  const loadTickerStatus = async (symbol) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/ticker-status?ticker=${symbol}`);
      const data = await res.json();
      setTickerStatus(data);
      
      if (data.status === 'training') {
        setTrainLoading(true);
        // Start polling if not already polling
        if (!pollIntervalRef.current) {
          startStatusPolling(symbol);
        }
      } else if (data.status === 'trained') {
        setTrainLoading(false);
        // Load predictions & explainability automatically
        fetchPredictionAndExplainability(symbol);
      } else {
        setTrainLoading(false);
        // Clean data if untrained
        setPredictionData(null);
        setExplainData(null);
      }
    } catch (err) {
      console.error("Failed to load ticker status", err);
    }
  };

  useEffect(() => {
    loadTickerStatus(ticker);
    return () => stopStatusPolling();
  }, [ticker]);

  // Polling logic for background training status
  const startStatusPolling = (symbol) => {
    stopStatusPolling();
    setLogMessages(["Training initiated on server...", "Awaiting data download..."]);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/api/ticker-status?ticker=${symbol}`);
        const data = await res.json();
        setTickerStatus(data);
        
        if (data.status === 'training') {
          setLogMessages(prev => {
            const nextLogs = [...prev];
            if (data.message && nextLogs[nextLogs.length - 1] !== data.message) {
              nextLogs.push(data.message);
            }
            return nextLogs;
          });
        } else if (data.status === 'trained' || data.status === 'failed') {
          stopStatusPolling();
          setTrainLoading(false);
          if (data.status === 'trained') {
            setLogMessages(prev => [...prev, "Training completed successfully!", "Saved models to disk."]);
            setTicker(symbol); // Refresh data
            fetchPredictionAndExplainability(symbol);
          } else {
            setLogMessages(prev => [...prev, `Training failed: ${data.message}`]);
          }
        }
      } catch (err) {
        console.error("Error polling training status", err);
      }
    }, 2500);
  };

  const stopStatusPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const fetchPredictionAndExplainability = async (symbol) => {
    setGeneralLoading(true);
    try {
      // Fetch Predictions
      const predRes = await apiFetch(`${API_BASE_URL}/api/predictions?ticker=${symbol}`);
      if (predRes.ok) {
        const predData = await predRes.json();
        setPredictionData(predData);
      }

      // Fetch Explainability
      const expRes = await apiFetch(`${API_BASE_URL}/api/explainability?ticker=${symbol}`);
      if (expRes.ok) {
        const expData = await expRes.json();
        setExplainData(expData);
      }
    } catch (err) {
      console.error("Failed to load predictions/explainability", err);
    } finally {
      setGeneralLoading(false);
    }
  };

  // Actions
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (tickerInput.trim()) {
      setTicker(tickerInput.trim().toUpperCase());
    }
  };

  const triggerTraining = async () => {
    setTrainLoading(true);
    setLogMessages(["Sending training request to backend..."]);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker,
          start_date: startDate,
          end_date: endDate,
          epochs: epochs
        })
      });
      const data = await res.json();
      if (data.success) {
        startStatusPolling(ticker);
      } else {
        setLogMessages(prev => [...prev, `Error: ${data.message}`]);
        setTrainLoading(false);
      }
    } catch (err) {
      setLogMessages(prev => [...prev, `Connection error during training request.`]);
      setTrainLoading(false);
    }
  };

  const triggerWfv = async () => {
    setWfvLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/wfv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker,
          epochs: 5
        })
      });
      if (res.ok) {
        const data = await res.json();
        setWfvData(data);
        setActiveTab('wfv');
      } else {
        const errData = await res.json();
        alert(`WFV failed: ${errData.detail || 'Unknown error'}`);
      }
    } catch (err) {
      alert("Failed to connect to the server for Walk-Forward Validation.");
    } finally {
      setWfvLoading(false);
    }
  };

  const triggerMonitoring = async () => {
    setMonitorLoading(true);
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/monitor?ticker=${ticker}`, {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setMonitorData(data);
        setActiveTab('monitor');
      } else {
        const errData = await res.json();
        alert(`Monitoring simulation failed: ${errData.detail || 'Unknown error'}`);
      }
    } catch (err) {
      alert("Failed to connect to the server for Daily Monitoring.");
    } finally {
      setMonitorLoading(false);
    }
  };

  // Chart Data preparation
  const getPredictionChartData = () => {
    if (!predictionData) return [];
    
    const chartData = [];
    
    // Add history (last 100 days train)
    predictionData.history.forEach(item => {
      chartData.push({
        date: item.date,
        close: item.close,
        arima: null,
        hybrid: null
      });
    });
    
    // Add test set forecasts
    predictionData.predictions.forEach(item => {
      chartData.push({
        date: item.date,
        close: item.actual,
        arima: item.arima,
        hybrid: item.hybrid
      });
    });
    
    return chartData;
  };

  return (
    <div className="app-container">
      {/* HEADER SECTION */}
      <header className="app-header">
        <div className="header-brand">
          <TrendingUp className="brand-logo" />
          <div className="brand-text">
            <h1>AI Stock Trend Prediction System</h1>
            <p>Hybrid ARIMA-LSTM Forecasting & Explainable AI Dashboard</p>
          </div>
        </div>
        
        {/* Status Indicator */}
        <div className="header-status">
          <div className={`status-badge ${backendStatus}`}>
            <span className="pulse-dot"></span>
            Backend: {backendStatus.toUpperCase()}
          </div>
        </div>
      </header>

      <div className="main-layout">
        {/* SIDEBAR CONFIGURATION */}
        <aside className="sidebar-panel">
          <div className="panel-section">
            <h2 className="section-title"><Search size={16} /> Asset Lookup</h2>
            <form onSubmit={handleSearchSubmit} className="search-form">
              <input 
                type="text" 
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                placeholder="Ticker symbol (e.g. AAPL)"
                disabled={trainLoading}
              />
              <button type="submit" disabled={trainLoading} className="search-btn">
                GO
              </button>
            </form>
            <div className="tag-group-container">
              <span className="tag-group-label">Stocks</span>
              <div className="ticker-tags">
                {['AAPL', 'MSFT', 'TSLA', 'GOOG', 'NVDA'].map(sym => (
                  <button 
                    key={sym} 
                    onClick={() => { setTickerInput(sym); setTicker(sym); }}
                    className={`tag-btn ${ticker === sym ? 'active' : ''}`}
                    disabled={trainLoading}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>

            <div className="tag-group-container" style={{ marginTop: '6px' }}>
              <span className="tag-group-label">Crypto</span>
              <div className="ticker-tags">
                {['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD'].map(sym => (
                  <button 
                    key={sym} 
                    onClick={() => { setTickerInput(sym); setTicker(sym); }}
                    className={`tag-btn ${ticker === sym ? 'active' : ''}`}
                    disabled={trainLoading}
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="panel-section">
            <h2 className="section-title"><Settings size={16} /> Training Configurations</h2>
            
            <div className="config-group">
              <label><Calendar size={14} /> Historical Range</label>
              <div className="date-inputs">
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={trainLoading}
                />
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={trainLoading}
                />
              </div>
            </div>

            <div className="config-group">
              <label>LSTM Training Epochs: <span className="highlight-val">{epochs}</span></label>
              <input 
                type="range" 
                min="1" 
                max="50" 
                value={epochs} 
                onChange={(e) => setEpochs(parseInt(e.target.value))}
                className="epochs-slider"
                disabled={trainLoading}
              />
            </div>

            <button 
              onClick={triggerTraining} 
              disabled={trainLoading || backendStatus !== 'connected'} 
              className="action-btn primary-btn"
            >
              {trainLoading ? (
                <>
                  <RefreshCw className="spin-icon" size={16} /> Training Pipeline Run...
                </>
              ) : (
                <>
                  <Play size={16} /> Fetch Data & Train Model
                </>
              )}
            </button>
          </div>

          <div className="panel-section">
            <h2 className="section-title"><Activity size={16} /> System Operations</h2>
            <div className="operation-buttons">
              <button 
                onClick={triggerWfv} 
                disabled={trainLoading || wfvLoading || tickerStatus?.status !== 'trained'} 
                className="action-btn secondary-btn"
              >
                {wfvLoading ? (
                  <RefreshCw className="spin-icon" size={16} />
                ) : (
                  "Run Walk-Forward Validation"
                )}
              </button>
              <button 
                onClick={triggerMonitoring} 
                disabled={trainLoading || monitorLoading || tickerStatus?.status !== 'trained'} 
                className="action-btn secondary-btn"
              >
                {monitorLoading ? (
                  <RefreshCw className="spin-icon" size={16} />
                ) : (
                  "Simulate Daily Monitoring"
                )}
              </button>
            </div>
          </div>
        </aside>

        {/* MAIN DISPLAY WORKSPACE */}
        <main className="content-panel">
          {/* Ticker Banner Details */}
          <section className="ticker-banner">
            <div className="banner-details">
              <h2>{ticker} Dashboard</h2>
              {tickerStatus?.status === 'trained' && tickerStatus.meta?.trained_at && (
                <span className="metadata-tag">
                  Model Trained: {new Date(tickerStatus.meta.trained_at).toLocaleString()}
                </span>
              )}
            </div>

            {predictionData && (
              <div className="banner-kpis">
                <div className="trend-glowing-card">
                  <span className="kpi-label">Tomorrow's Prediction Trend</span>
                  <div className={`kpi-value trend-${predictionData.predicted_direction_tomorrow.toLowerCase()}`}>
                    {predictionData.predicted_direction_tomorrow === 'Up' ? (
                      <><TrendingUp size={24} /> UP</>
                    ) : (
                      <><TrendingDown size={24} /> DOWN</>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* MAIN CORE METRICS GRID */}
          {tickerStatus?.status === 'trained' && predictionData && (
            <section className="metrics-grid">
              <div className="metric-card">
                <span className="metric-title">Latest Close Price</span>
                <span className="metric-value">${predictionData.latest_close.toFixed(2)}</span>
                <span className="metric-subtitle">Historical Price</span>
              </div>
              <div className="metric-card">
                <span className="metric-title">Predicted Next Close</span>
                <span className="metric-value">${predictionData.predicted_close_tomorrow.toFixed(2)}</span>
                <span className="metric-subtitle">ARIMA + LSTM residual</span>
              </div>
              <div className="metric-card">
                <span className="metric-title">Directional Accuracy</span>
                <span className="metric-value">{(predictionData.directional_accuracy * 100).toFixed(1)}%</span>
                <span className="metric-subtitle">Out-of-sample Test accuracy</span>
              </div>
              <div className="metric-card">
                <span className="metric-title">Model Health Status</span>
                {monitorData?.decay_warning ? (
                  <span className="metric-value warning-text"><ShieldAlert size={20} /> DECAYED</span>
                ) : (
                  <span className="metric-value success-text"><CheckCircle size={20} /> HEALTHY</span>
                )}
                <span className="metric-subtitle">Trailing test metrics</span>
              </div>
            </section>
          )}

          {/* TRAINING PIPELINE CONSOLE LOG */}
          {trainLoading && (
            <section className="console-panel">
              <div className="console-header">
                <h3><RefreshCw className="spin-icon" size={16} /> Backend Pipeline Training Console Log</h3>
              </div>
              <div className="console-body">
                {logMessages.map((msg, i) => (
                  <div key={i} className="console-line">
                    <span className="console-timestamp">[{new Date().toLocaleTimeString()}]</span> {msg}
                  </div>
                ))}
                <div className="console-spinner">
                  <div className="dot-pulse"></div>
                </div>
              </div>
            </section>
          )}

          {/* GENERAL INTERFACE BLOCK IF UNTRAINED */}
          {tickerStatus?.status === 'untrained' && !trainLoading && (
            <div className="empty-state-card">
              <AlertTriangle className="empty-icon" size={48} />
              <h2>Model Untrained for {ticker}</h2>
              <p>
                No hybrid forecasting models were found on disk for ticker symbol **{ticker}**. 
                Click the button below or in the sidebar to download Yahoo Finance daily price data and execute the ML pipeline.
              </p>
              <button onClick={triggerTraining} className="action-btn primary-btn large-btn">
                <Play size={16} /> Fetch & Train ARIMA-LSTM Hybrid
              </button>
            </div>
          )}

          {/* DASHBOARD TAB WORKSPACE */}
          {tickerStatus?.status === 'trained' && predictionData && !trainLoading && (
            <div className="workspace-tabs-container">
              {/* Tab headers */}
              <div className="tab-headers">
                <button 
                  onClick={() => setActiveTab('predictions')} 
                  className={`tab-link ${activeTab === 'predictions' ? 'active' : ''}`}
                >
                  🔮 Predictions
                </button>
                <button 
                  onClick={() => setActiveTab('explainability')} 
                  className={`tab-link ${activeTab === 'explainability' ? 'active' : ''}`}
                >
                  💡 Explainability (SHAP)
                </button>
                <button 
                  onClick={() => setActiveTab('wfv')} 
                  className={`tab-link ${activeTab === 'wfv' ? 'active' : ''}`}
                >
                  📊 Walk-Forward Validation
                </button>
                <button 
                  onClick={() => setActiveTab('monitor')} 
                  className={`tab-link ${activeTab === 'monitor' ? 'active' : ''}`}
                >
                  🚨 Monitoring & Decay
                </button>
              </div>

              {/* Tab bodies */}
              <div className="tab-content">
                {/* Predictions Tab */}
                {activeTab === 'predictions' && (
                  <div className="tab-panel">
                    <div className="panel-header-desc">
                      <h3>Historical Prices & Out-of-Sample Predictions</h3>
                      <p>Displays the actual Close prices alongside ARIMA forecasts and combined ARIMA-LSTM predictions on the out-of-sample Test dataset (final 20% slice).</p>
                    </div>

                    <div className="chart-wrapper">
                      <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={getPredictionChartData()}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2e333d" />
                          <XAxis dataKey="date" stroke="#8a909d" />
                          <YAxis stroke="#8a909d" domain={['auto', 'auto']} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e222b', borderColor: '#2e333d', color: '#fff' }}
                          />
                          <Legend />
                          <Line 
                            type="monotone" 
                            dataKey="close" 
                            name="Actual Close" 
                            stroke="#00e676" 
                            dot={false}
                            strokeWidth={2}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="arima" 
                            name="ARIMA Forecast Only" 
                            stroke="#ff9100" 
                            dot={false} 
                            strokeDasharray="5 5"
                            strokeWidth={1.5}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="hybrid" 
                            name="ARIMA-LSTM Hybrid Predict" 
                            stroke="#2979ff" 
                            dot={false}
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Explainability Tab */}
                {activeTab === 'explainability' && explainData && (
                  <div className="tab-panel">
                    <div className="panel-header-desc">
                      <h3>LightGBM SHAP-like Feature Contributions</h3>
                      <p>Shows how much each technical indicator contributed directly to tomorrow's trend prediction (Up or Down Close price). A positive contribution increases the probability of an "Up" trend prediction.</p>
                    </div>

                    <div className="explain-split">
                      <div className="chart-box">
                        <h4>Contribution Weights</h4>
                        <div className="chart-wrapper" style={{ height: '350px' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={explainData.contributions}
                              layout="vertical"
                              margin={{ top: 5, right: 30, left: 80, bottom: 5 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#2e333d" />
                              <XAxis type="number" stroke="#8a909d" />
                              <YAxis dataKey="feature" type="category" stroke="#8a909d" width={100} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#1e222b', borderColor: '#2e333d', color: '#fff' }}
                              />
                              <ReferenceLine x={0} stroke="#8a909d" />
                              <Bar dataKey="contribution" fill="#8884d8">
                                {explainData.contributions.map((entry, index) => (
                                  <Cell 
                                    key={`cell-${index}`} 
                                    fill={entry.contribution >= 0 ? '#00e676' : '#ff1744'} 
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="importance-table-box">
                        <h4>Overall Relative Feature Importance (Gain)</h4>
                        <div className="scroll-table-container">
                          <table className="info-table">
                            <thead>
                              <tr>
                                <th>Feature Indicator</th>
                                <th>Gain Weight</th>
                              </tr>
                            </thead>
                            <tbody>
                              {explainData.importances.map((item, idx) => (
                                <tr key={idx}>
                                  <td className="font-mono">{item.feature}</td>
                                  <td>{item.importance.toLocaleString(undefined, {maximumFractionDigits: 2})}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Walk-Forward Validation Tab */}
                {activeTab === 'wfv' && (
                  <div className="tab-panel">
                    <div className="panel-header-desc">
                      <h3>Walk-Forward Validation Folds Performance</h3>
                      <p>Simulates rolling training-and-test intervals to verify if the predictive models hold robust trading ratios (Sharpe, drawdowns, accuracy) under shifting market conditions.</p>
                    </div>

                    {wfvData ? (
                      <div className="wfv-content">
                        {/* WFV Summary Cards */}
                        <div className="wfv-metrics-grid">
                          <div className="wfv-sub-card">
                            <span className="wfv-sub-title">Avg Roll Accuracy</span>
                            <span className="wfv-sub-value">{(wfvData.average_accuracy * 100).toFixed(2)}%</span>
                          </div>
                          <div className="wfv-sub-card">
                            <span className="wfv-sub-title">Avg Sharpe Ratio</span>
                            <span className="wfv-sub-value">{wfvData.average_sharpe.toFixed(4)}</span>
                          </div>
                          <div className="wfv-sub-card">
                            <span className="wfv-sub-title">Avg Max Drawdown</span>
                            <span className="wfv-sub-value">{(wfvData.average_max_dd * 100).toFixed(2)}%</span>
                          </div>
                        </div>

                        {/* WFV Folds Grid Table */}
                        <div className="wfv-table-container">
                          <table className="info-table">
                            <thead>
                              <tr>
                                <th>Fold Index</th>
                                <th>Validation Time Window</th>
                                <th>Directional Accuracy</th>
                                <th>Sharpe Ratio</th>
                                <th>Max Drawdown</th>
                              </tr>
                            </thead>
                            <tbody>
                              {wfvData.folds.map((fold, i) => (
                                <tr key={i}>
                                  <td>Fold {fold.fold}</td>
                                  <td>{fold.start_date} <ArrowRight size={12} style={{ display: 'inline', margin: '0 4px' }} /> {fold.end_date}</td>
                                  <td className="highlight-metric">{(fold.accuracy * 100).toFixed(1)}%</td>
                                  <td>{fold.sharpe.toFixed(4)}</td>
                                  <td className="negative-val">{(fold.max_dd * 100).toFixed(2)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="tab-empty-state">
                        <AlertTriangle size={24} />
                        <h4>No validation logs available</h4>
                        <p>Walk-forward validation has not been run in this session. Click the button to calculate rolling-fold predictions.</p>
                        <button onClick={triggerWfv} disabled={wfvLoading} className="action-btn secondary-btn">
                          {wfvLoading ? "Computing Validation..." : "Execute Walk-Forward Validation"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Monitoring Tab */}
                {activeTab === 'monitor' && (
                  <div className="tab-panel">
                    <div className="panel-header-desc">
                      <h3>Daily Model Tracking & Accuracy Monitoring</h3>
                      <p>Updates yesterday's forecasted direction with the actual closing price direction. Tracks daily accuracy degradation and triggers decay retrain alerts if rolling performance dips below 50%.</p>
                    </div>

                    {monitorData ? (
                      <div className="monitor-content">
                        {/* Monitor summary */}
                        <div className="monitor-summary-card">
                          <div className="summary-left">
                            <h4>Rolling Monitoring Accuracy: <span className="highlight-acc">{(monitorData.rolling_accuracy * 100).toFixed(2)}%</span></h4>
                            <p>Evaluated across {monitorData.total_evaluated_days} daily prediction cycles.</p>
                          </div>
                          <div className="summary-right">
                            {monitorData.decay_warning ? (
                              <div className="alert-box decay-alert">
                                <ShieldAlert size={20} />
                                <div>
                                  <strong>Model Decay Alert!</strong>
                                  <span>Rolling accuracy is below 50% threshold. Immediate retraining is recommended!</span>
                                </div>
                              </div>
                            ) : (
                              <div className="alert-box healthy-alert">
                                <CheckCircle size={20} />
                                <div>
                                  <strong>System Status: Optimal</strong>
                                  <span>Predictive models are scoring above the 50% warning threshold.</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Monitor Logs Table */}
                        <div className="monitor-table-container">
                          <h4>Trailing Prediction Logs</h4>
                          <table className="info-table">
                            <thead>
                              <tr>
                                <th>Trading Date</th>
                                <th>Predicted Close</th>
                                <th>Predicted Direction</th>
                                <th>Actual Close Price</th>
                                <th>Actual Direction</th>
                                <th>Verification Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {monitorData.history.map((row, idx) => (
                                <tr key={idx} className={row.correct === true ? 'row-correct' : row.correct === false ? 'row-incorrect' : ''}>
                                  <td>{row.date}</td>
                                  <td>{row.predicted_close ? `$${row.predicted_close.toFixed(2)}` : '-'}</td>
                                  <td>{row.predicted_direction || '-'}</td>
                                  <td>{row.actual_close ? `$${row.actual_close.toFixed(2)}` : '-'}</td>
                                  <td>{row.actual_direction || '-'}</td>
                                  <td>
                                    {row.correct === true && <span className="status-label success"><CheckCircle size={12} /> Correct</span>}
                                    {row.correct === false && <span className="status-label danger"><XCircle size={12} /> Missed</span>}
                                    {row.correct === null && <span className="status-label pending">Pending Market Close</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="tab-empty-state">
                        <AlertTriangle size={24} />
                        <h4>Daily Tracking Log Empty</h4>
                        <p>No tracking logs were simulated for the current ticker. Run the monitoring tracker simulation now.</p>
                        <button onClick={triggerMonitoring} disabled={monitorLoading} className="action-btn secondary-btn">
                          {monitorLoading ? "Simulating Update..." : "Run Daily Monitoring Simulation"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
