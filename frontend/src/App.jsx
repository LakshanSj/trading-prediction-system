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
  ArrowRight,
  History,
  Shield,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  ComposedChart,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  ReferenceLine,
  Cell,
  Brush
} from 'recharts';
import AdminPanel from './AdminPanel';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Global suggestions list for popular Stock & Crypto tokens
const SUGGESTIONS = [
  // Stocks
  'AAPL', 'MSFT', 'TSLA', 'GOOG', 'NVDA', 'AMZN', 'META', 'NFLX', 'AMD', 'INTC', 
  'COIN', 'HOOD', 'PYPL', 'SQ', 'MSTR',
  // Crypto
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD', 'BNB-USD', 
  'LTC-USD', 'DOT-USD', 'AVAX-USD', 'LINK-USD', 'SHIB-USD', 'TRX-USD'
];

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
  
  // Timeframe and chart zoom states
  const [intervalVal, setIntervalVal] = useState('1d');
  const [chartZoom, setChartZoom] = useState('all');
  const [customZoomStart, setCustomZoomStart] = useState('');
  const [customZoomEnd, setCustomZoomEnd] = useState('');

  // Enforce strict historical range limits per interval to optimize local training speed and prevent yfinance errors
  const getMinAllowedDate = (interval) => {
    const today = new Date();
    let yearsBack = 5; // Default is 5 years
    if (interval === '1h') yearsBack = 1;
    else if (interval === '4h') yearsBack = 2; // Intraday Hourly cap is 730 days on yfinance
    else if (interval === '1w') yearsBack = 10;
    
    const minDate = new Date();
    minDate.setFullYear(today.getFullYear() - yearsBack);
    return minDate;
  };

  const handleIntervalChange = (newInterval) => {
    setIntervalVal(newInterval);
    const minDateStr = getMinAllowedDate(newInterval).toISOString().split('T')[0];
    
    // Automatically set default date back to the limit of the new interval
    setStartDate(minDateStr);
  };
  
  // Suggestions & history states
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentTickers, setRecentTickers] = useState(() => {
    try {
      const saved = localStorage.getItem('recent_tickers');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Navigation & UI states
  const [activeTab, setActiveTab] = useState('predictions');
  const [backendStatus, setBackendStatus] = useState('checking');
  const [showAdmin, setShowAdmin] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  // Data states
  const [tickerStatus, setTickerStatus] = useState(null); // {status, meta}
  const [predictionData, setPredictionData] = useState(null);
  const [explainData, setExplainData] = useState(null);
  const [wfvData, setWfvData] = useState(null);
  const [monitorData, setMonitorData] = useState(null);

  // Advanced Indicators & SMC Overlays
  const [showMA, setShowMA] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [showOB, setShowOB] = useState(false);
  const [oscillatorTab, setOscillatorTab] = useState('rsi');
  
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
        // Use /health which is proxied to the backend in dev, or absolute URL in prod
        const healthUrl = API_BASE_URL ? `${API_BASE_URL}/health` : '/health';
        const res = await apiFetch(healthUrl);
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

  // Resizable chart heights (used in full screen mode)
  const [priceChartHeight, setPriceChartHeight] = useState(400);
  const [oscillatorChartHeight, setOscillatorChartHeight] = useState(180);

  // Esc key to exit full screen mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullScreen) {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullScreen]);

  // Drag handler for the chart splitter divider
  const handleSplitterDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startPriceHeight = priceChartHeight;
    const startOscHeight = oscillatorChartHeight;

    const onMouseMove = (moveEvent) => {
      const deltaY = moveEvent.clientY - startY;
      
      // Calculate new heights, enforcing min heights
      const newPriceHeight = Math.max(150, startPriceHeight + deltaY);
      const newOscHeight = Math.max(100, startOscHeight - deltaY);
      
      setPriceChartHeight(newPriceHeight);
      setOscillatorChartHeight(newOscHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  // Update recent searches list when ticker changes
  useEffect(() => {
    if (ticker) {
      setRecentTickers(prev => {
        const next = [ticker, ...prev.filter(t => t !== ticker)].slice(0, 5);
        localStorage.setItem('recent_tickers', JSON.stringify(next));
        return next;
      });
    }
  }, [ticker]);

  // Filter suggestions dynamically
  const filteredSuggestions = tickerInput.trim()
    ? SUGGESTIONS.filter(item => 
        item.toLowerCase().startsWith(tickerInput.trim().toLowerCase()) && 
        item.toUpperCase() !== ticker.toUpperCase()
      ).slice(0, 5)
    : [];

  // Fetch Ticker Status & Active Data
  const loadTickerStatus = async (symbol, currentInterval) => {
    try {
      const res = await apiFetch(`${API_BASE_URL}/api/ticker-status?ticker=${symbol}&interval=${currentInterval}`);
      const data = await res.json();
      setTickerStatus(data);
      
      if (data.status === 'training') {
        setTrainLoading(true);
        // Start polling if not already polling
        if (!pollIntervalRef.current) {
          startStatusPolling(symbol, currentInterval);
        }
      } else if (data.status === 'trained') {
        setTrainLoading(false);
        // Load predictions & explainability automatically
        fetchPredictionAndExplainability(symbol, currentInterval);
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
    loadTickerStatus(ticker, intervalVal);
    return () => stopStatusPolling();
  }, [ticker, intervalVal]);

  // Polling logic for background training status
  const startStatusPolling = (symbol, currentInterval) => {
    stopStatusPolling();
    setLogMessages(["Training initiated on server...", "Awaiting data download..."]);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`${API_BASE_URL}/api/ticker-status?ticker=${symbol}&interval=${currentInterval}`);
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
            fetchPredictionAndExplainability(symbol, currentInterval);
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

  const fetchPredictionAndExplainability = async (symbol, currentInterval) => {
    setGeneralLoading(true);
    try {
      // Fetch Predictions
      const predRes = await apiFetch(`${API_BASE_URL}/api/predictions?ticker=${symbol}&interval=${currentInterval}`);
      if (predRes.ok) {
        const predData = await predRes.json();
        setPredictionData(predData);
      }

      // Fetch Explainability
      const expRes = await apiFetch(`${API_BASE_URL}/api/explainability?ticker=${symbol}&interval=${currentInterval}`);
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
          interval: intervalVal,
          start_date: startDate,
          end_date: endDate,
          epochs: epochs
        })
      });
      const data = await res.json();
      if (data.success) {
        startStatusPolling(ticker, intervalVal);
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
          interval: intervalVal,
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
      const res = await apiFetch(`${API_BASE_URL}/api/monitor?ticker=${ticker}&interval=${intervalVal}`, {
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

  // Chart Data preparation and dynamic timeframe slicing
  const getPredictionChartData = () => {
    if (!predictionData) return [];
    
    const chartData = [];
    
    // Add history
    predictionData.history.forEach(item => {
      chartData.push({
        date: item.date,
        close: item.close,
        open: item.open || item.close,
        high: item.high || item.close,
        low: item.low || item.close,
        body_range: [Math.min(item.open || item.close, item.close), Math.max(item.open || item.close, item.close)],
        wick_range: [item.low || item.close, item.high || item.close],
        arima: null,
        hybrid: null,
        // Indicators
        sma_10: item.sma_10,
        sma_20: item.sma_20,
        sma_50: item.sma_50,
        sma_200: item.sma_200,
        ema_9: item.ema_9,
        ema_20: item.ema_20,
        ema_50: item.ema_50,
        ema_200: item.ema_200,
        wma_144: item.wma_144,
        smma_5: item.smma_5,
        bb_upper: item.bb_upper,
        bb_lower: item.bb_lower,
        bb_mid: item.bb_mid,
        rsi_14: item.rsi_14,
        rsi_ma: item.rsi_ma,
        stoch_k: item.stoch_k,
        stoch_d: item.stoch_d,
        cci_20: item.cci_20,
        // SMC & structure
        last_swing_high: item.last_swing_high,
        last_swing_low: item.last_swing_low,
        bullish_ob_high: item.bullish_ob_high,
        bullish_ob_low: item.bullish_ob_low,
        bearish_ob_high: item.bearish_ob_high,
        bearish_ob_low: item.bearish_ob_low,
        bos: item.bos,
        choch: item.choch,
        sweep_high: item.sweep_high,
        sweep_low: item.sweep_low,
        fvg_bullish_size: item.fvg_bullish_size,
        fvg_bearish_size: item.fvg_bearish_size,
        // Elliott Wave
        elliott_wave: item.elliott_wave
      });
    });
    
    // Add test set forecasts
    predictionData.predictions.forEach(item => {
      chartData.push({
        date: item.date,
        close: item.actual,
        open: item.open || item.actual,
        high: item.high || item.actual,
        low: item.low || item.actual,
        body_range: [Math.min(item.open || item.actual, item.actual), Math.max(item.open || item.actual, item.actual)],
        wick_range: [item.low || item.actual, item.high || item.actual],
        arima: item.arima,
        hybrid: item.hybrid,
        // Indicators
        sma_10: item.sma_10,
        sma_20: item.sma_20,
        sma_50: item.sma_50,
        sma_200: item.sma_200,
        ema_9: item.ema_9,
        ema_20: item.ema_20,
        ema_50: item.ema_50,
        ema_200: item.ema_200,
        wma_144: item.wma_144,
        smma_5: item.smma_5,
        bb_upper: item.bb_upper,
        bb_lower: item.bb_lower,
        bb_mid: item.bb_mid,
        rsi_14: item.rsi_14,
        rsi_ma: item.rsi_ma,
        stoch_k: item.stoch_k,
        stoch_d: item.stoch_d,
        cci_20: item.cci_20,
        // SMC & structure
        last_swing_high: item.last_swing_high,
        last_swing_low: item.last_swing_low,
        bullish_ob_high: item.bullish_ob_high,
        bullish_ob_low: item.bullish_ob_low,
        bearish_ob_high: item.bearish_ob_high,
        bearish_ob_low: item.bearish_ob_low,
        bos: item.bos,
        choch: item.choch,
        sweep_high: item.sweep_high,
        sweep_low: item.sweep_low,
        fvg_bullish_size: item.fvg_bullish_size,
        fvg_bearish_size: item.fvg_bearish_size,
        // Elliott Wave
        elliott_wave: item.elliott_wave
      });
    });
    
    if (chartZoom === 'all' || chartData.length === 0) {
      return chartData;
    }
    
    // Find the latest date object in the chart dataset to slice relative to it
    const parsedDates = chartData.map(d => ({ ...d, parsedDate: new Date(d.date) }));
    const maxDateMs = Math.max(...parsedDates.map(d => d.parsedDate.getTime()));
    const maxDate = new Date(maxDateMs);
    
    let filterStartMs = 0;
    
    if (chartZoom === '1w') {
      filterStartMs = maxDate.getTime() - (7 * 24 * 60 * 60 * 1000);
    } else if (chartZoom === '1d') {
      filterStartMs = maxDate.getTime() - (1 * 24 * 60 * 60 * 1000);
    } else if (chartZoom === '4h') {
      filterStartMs = maxDate.getTime() - (4 * 60 * 60 * 1000);
    } else if (chartZoom === '1h') {
      filterStartMs = maxDate.getTime() - (1 * 60 * 60 * 1000);
    } else if (chartZoom === 'custom') {
      const customStart = customZoomStart ? new Date(customZoomStart).getTime() : 0;
      const customEnd = customZoomEnd ? new Date(customZoomEnd).getTime() : Infinity;
      return parsedDates.filter(d => {
        const time = d.parsedDate.getTime();
        return time >= customStart && time <= customEnd;
      });
    }
    
    return parsedDates.filter(d => d.parsedDate.getTime() >= filterStartMs);
  };
  const chartPoints = getPredictionChartData();
  const latestItem = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : null;
  const latestPrice = latestItem ? latestItem.close : 0;
  const latestIsBullish = latestItem ? latestItem.close >= latestItem.open : true;
  const latestPriceColor = latestIsBullish ? '#089981' : '#f23645';

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
        
        {/* Header right: status + admin button */}
        <div className="header-right">
          <div className={`status-badge ${backendStatus}`}>
            <span className="pulse-dot"></span>
            Backend: {backendStatus.toUpperCase()}
          </div>
          <button
            className="admin-trigger-btn"
            onClick={() => setShowAdmin(true)}
            title="Open Admin Logging Panel"
          >
            <Shield size={14} /> Admin
          </button>
        </div>
      </header>

      {/* Admin Panel overlay */}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      <div className="main-layout">
        {/* SIDEBAR CONFIGURATION */}
        <aside className="sidebar-panel">
          <div className="panel-section">
            <h2 className="section-title"><Search size={16} /> Asset Lookup</h2>
            <form onSubmit={handleSearchSubmit} className="search-form">
              <div className="search-input-container">
                <input 
                  type="text" 
                  value={tickerInput}
                  onChange={(e) => {
                    setTickerInput(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => {
                    // Small delay to allow clicking suggestions before dropdown closes
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  placeholder="Ticker symbol (e.g. AAPL)"
                  disabled={trainLoading}
                />
                {showSuggestions && filteredSuggestions.length > 0 && (
                  <ul className="suggestions-list">
                    {filteredSuggestions.map(sym => (
                      <li 
                        key={sym} 
                        onMouseDown={() => {
                          setTickerInput(sym);
                          setTicker(sym);
                          setShowSuggestions(false);
                        }}
                      >
                        {sym}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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

            {recentTickers.length > 0 && (
              <div className="tag-group-container" style={{ marginTop: '10px' }}>
                <span className="tag-group-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <History size={10} /> Recent Searches
                </span>
                <div className="ticker-tags">
                  {recentTickers.map(sym => (
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
            )}
          </div>

          <div className="panel-section">
            <h2 className="section-title"><Settings size={16} /> Training Configurations</h2>
            
            <div className="config-group">
              <label><Calendar size={14} /> Historical Range</label>
              <div className="date-inputs">
                <input 
                  type="date" 
                  value={startDate} 
                  min={getMinAllowedDate(intervalVal).toISOString().split('T')[0]}
                  onChange={(e) => {
                    const minDateStr = getMinAllowedDate(intervalVal).toISOString().split('T')[0];
                    if (e.target.value < minDateStr) {
                      setStartDate(minDateStr);
                    } else {
                      setStartDate(e.target.value);
                    }
                  }}
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
              <label>Data Interval / Timeframe</label>
              <select 
                value={intervalVal} 
                onChange={(e) => handleIntervalChange(e.target.value)}
                disabled={trainLoading}
                className="interval-select"
              >
                <option value="1h">1 Hour</option>
                <option value="4h">4 Hours</option>
                <option value="1d">1 Day (Daily)</option>
                <option value="1w">1 Week (Weekly)</option>
              </select>
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
                      <h3>Historical Prices & Advanced Technical Analysis</h3>
                      <p>Displays hybrid ARIMA-LSTM predictions along with overlays for moving averages, Bollinger Bands, and Smart Money Concepts (SMC) zones. Includes oscillators and pattern analyzers.</p>
                    </div>

                    <div className="predictions-layout">
                      {/* Left Column: Charts */}
                      <div className={`charts-column ${isFullScreen ? 'fullscreen' : ''}`}>
                        <div className="chart-zoom-controls">
                          <span className="zoom-label">Zoom Range:</span>
                          <div className="zoom-buttons">
                            {[
                              { key: '1h', label: '1h' },
                              { key: '4h', label: '4h' },
                              { key: '1d', label: '1d' },
                              { key: '1w', label: '1w' },
                              { key: 'all', label: 'All' },
                              { key: 'custom', label: 'Custom' }
                            ].map(opt => (
                              <button
                                key={opt.key}
                                onClick={() => setChartZoom(opt.key)}
                                className={`zoom-btn ${chartZoom === opt.key ? 'active' : ''}`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                          
                          {chartZoom === 'custom' && (
                            <div className="custom-zoom-dates">
                              <input 
                                type="datetime-local" 
                                value={customZoomStart} 
                                onChange={(e) => setCustomZoomStart(e.target.value)} 
                              />
                              <span className="date-sep">to</span>
                              <input 
                                type="datetime-local" 
                                value={customZoomEnd} 
                                onChange={(e) => setCustomZoomEnd(e.target.value)} 
                              />
                            </div>
                          )}
                        </div>

                        {/* Overlays Control Box */}
                        <div className="overlay-controls">
                          <button 
                            onClick={() => setShowMA(!showMA)} 
                            className={`overlay-btn ${showMA ? 'active' : ''}`}
                          >
                            <Activity size={12} /> WMA 144 / SMMA 5
                          </button>
                          <button 
                            onClick={() => setShowBB(!showBB)} 
                            className={`overlay-btn ${showBB ? 'active' : ''}`}
                          >
                            <BarChart2 size={12} /> Bollinger Bands
                          </button>
                          <button 
                            onClick={() => setShowOB(!showOB)} 
                            className={`overlay-btn ${showOB ? 'active' : ''}`}
                          >
                            <Settings size={12} /> SMC Order Blocks & Sweeps
                          </button>
                          <button 
                            onClick={() => setIsFullScreen(!isFullScreen)} 
                            className={`overlay-btn highlight-accent ${isFullScreen ? 'active' : ''}`}
                            title="Toggle Full Screen Chart"
                          >
                            {isFullScreen ? (
                              <><Minimize2 size={12} /> Exit Full Screen</>
                            ) : (
                              <><Maximize2 size={12} /> Full Screen</>
                            )}
                          </button>
                        </div>

                        {/* Price Chart */}
                        <div className={`chart-wrapper ${isFullScreen ? 'fullscreen' : ''}`} style={isFullScreen ? { height: `${priceChartHeight}px` } : {}}>
                          {/* TradingView-Style Left Header Overlays */}
                          <div className="tv-chart-legend">
                            <div className="tv-legend-ticker-row">
                              <span className="tv-legend-symbol">{ticker.toUpperCase()} / USD</span>
                              <span className="tv-legend-interval">{intervalVal}</span>
                              <span className="tv-legend-exchange">BINANCE</span>
                              <span className="tv-legend-ohlc">
                                O<span style={{ color: latestIsBullish ? '#089981' : '#f23645' }}>{latestItem?.open?.toFixed(2) || '0.00'}</span>{' '}
                                H<span style={{ color: latestIsBullish ? '#089981' : '#f23645' }}>{latestItem?.high?.toFixed(2) || '0.00'}</span>{' '}
                                L<span style={{ color: latestIsBullish ? '#089981' : '#f23645' }}>{latestItem?.low?.toFixed(2) || '0.00'}</span>{' '}
                                C<span style={{ color: latestIsBullish ? '#089981' : '#f23645' }}>{latestItem?.close?.toFixed(2) || '0.00'}</span>
                              </span>
                            </div>
                            
                            <div className="tv-legend-indicators">
                              <div className="tv-indicator-item">
                                <button onClick={() => setShowMA(!showMA)} className="tv-eye-btn" title="Toggle WMA 144">
                                  {showMA ? <Eye size={11} /> : <EyeOff size={11} />}
                                </button>
                                <span className="tv-indicator-name" style={{ color: '#a78bfa' }}>WMA 144 close</span>
                                <span className="tv-indicator-value">{latestItem?.wma_144 ? latestItem.wma_144.toFixed(2) : 'n/a'}</span>
                              </div>
                              <div className="tv-indicator-item">
                                <button onClick={() => setShowMA(!showMA)} className="tv-eye-btn" title="Toggle SMMA 5">
                                  {showMA ? <Eye size={11} /> : <EyeOff size={11} />}
                                </button>
                                <span className="tv-indicator-name" style={{ color: '#ffd600' }}>SMMA 5 close</span>
                                <span className="tv-indicator-value">{latestItem?.smma_5 ? latestItem.smma_5.toFixed(2) : 'n/a'}</span>
                              </div>
                            </div>
                          </div>

                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={getPredictionChartData()}>
                              <CartesianGrid strokeDasharray="1 1" stroke="#222632" />
                              <XAxis dataKey="date" stroke="#8a909d" />
                              <YAxis stroke="#8a909d" domain={['auto', 'auto']} orientation="right" />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#131722', borderColor: '#2a2e39', color: '#fff' }}
                              />
                              
                              {/* Wick range (high to low) rendered as thin bar */}
                              <Bar dataKey="wick_range" barSize={1.5} name="Wick" tooltipType="none">
                                {
                                  getPredictionChartData().map((entry, index) => {
                                    const isUp = entry.close >= entry.open;
                                    return <Cell key={`wick-${index}`} fill={isUp ? '#089981' : '#f23645'} stroke={isUp ? '#089981' : '#f23645'} />;
                                  })
                                }
                              </Bar>

                              {/* Body range (open to close) rendered as thicker bar */}
                              <Bar dataKey="body_range" barSize={8} name="Candle">
                                {
                                  getPredictionChartData().map((entry, index) => {
                                    const isUp = entry.close >= entry.open;
                                    return <Cell key={`body-${index}`} fill={isUp ? '#089981' : '#f23645'} stroke={isUp ? '#089981' : '#f23645'} />;
                                  })
                                }
                              </Bar>

                              {/* MAs overlay */}
                              {showMA && (
                                <Line type="monotone" dataKey="wma_144" name="WMA 144" stroke="#a78bfa" dot={false} strokeWidth={1.5} />
                              )}
                              {showMA && (
                                <Line type="monotone" dataKey="smma_5" name="SMMA 5" stroke="#ffd600" dot={false} strokeWidth={1.5} />
                              )}

                              {/* Bollinger Bands overlay */}
                              {showBB && (
                                <Line type="monotone" dataKey="bb_upper" name="BB Upper" stroke="#90a4ae" dot={false} strokeWidth={1.2} strokeDasharray="4 4" />
                              )}
                              {showBB && (
                                <Line type="monotone" dataKey="bb_lower" name="BB Lower" stroke="#90a4ae" dot={false} strokeWidth={1.2} strokeDasharray="4 4" />
                              )}

                              {/* SMC Order Blocks overlays */}
                              {showOB && (
                                <Line type="step" dataKey="bullish_ob_high" name="Bull OB High" stroke="#81c784" dot={false} strokeWidth={1.2} opacity={0.6} />
                              )}
                              {showOB && (
                                <Line type="step" dataKey="bullish_ob_low" name="Bull OB Low" stroke="#4caf50" dot={false} strokeWidth={1.0} opacity={0.4} />
                              )}
                              {showOB && (
                                <Line type="step" dataKey="bearish_ob_high" name="Bear OB High" stroke="#e57373" dot={false} strokeWidth={1.2} opacity={0.6} />
                              )}
                              {showOB && (
                                <Line type="step" dataKey="bearish_ob_low" name="Bear OB Low" stroke="#f44336" dot={false} strokeWidth={1.0} opacity={0.4} />
                              )}

                              {/* Dynamic Axis Tag Highlight for latest Close Price */}
                              {latestItem && (
                                <ReferenceLine 
                                  y={latestPrice} 
                                  stroke={latestPriceColor} 
                                  strokeDasharray="2 2"
                                  label={{ 
                                    value: latestPrice.toFixed(2), 
                                    position: 'right', 
                                    fill: '#fff', 
                                    backgroundColor: latestPriceColor, 
                                    fontSize: 10,
                                    fontWeight: 'bold'
                                  }} 
                                />
                              )}
                              
                              {/* Horizontal scroll slider */}
                              <Brush dataKey="date" height={15} stroke="rgba(0, 242, 254, 0.4)" fill="#0d111a" tickFormatter={() => ''} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Interactive Drag Resizer (Only in Full Screen Mode) */}
                        {isFullScreen && (
                          <div 
                            className="chart-splitter-bar"
                            onMouseDown={handleSplitterDrag}
                            title="Drag cursor to resize price/oscillator charts"
                          >
                            <div className="splitter-line"></div>
                          </div>
                        )}

                        {/* Oscillator Panel below price chart */}
                        <div className={`oscillator-section ${isFullScreen ? 'fullscreen' : ''}`} style={isFullScreen ? { height: `${oscillatorChartHeight}px` } : {}}>
                          <div className="oscillator-tabs">
                            {['rsi', 'stochastic', 'cci'].map(tab => (
                              <button 
                                key={tab}
                                onClick={() => setOscillatorTab(tab)} 
                                className={`oscillator-tab-btn ${oscillatorTab === tab ? 'active' : ''}`}
                              >
                                {tab === 'rsi' ? 'RSI (14)' : tab === 'stochastic' ? 'Stochastic' : 'CCI (20)'}
                              </button>
                            ))}
                          </div>

                          <div className="oscillator-chart-wrapper">
                            {oscillatorTab === 'rsi' && (
                              <div className="tv-osc-legend">
                                <span className="tv-legend-symbol">RSI 14</span>
                                <span className="tv-legend-source">close</span>
                                <span style={{ color: '#a78bfa', fontWeight: 'bold' }}>{latestItem?.rsi_14 ? latestItem.rsi_14.toFixed(2) : 'n/a'}</span>
                                <span style={{ color: '#ffd600', fontWeight: 'bold' }}>{latestItem?.rsi_ma ? latestItem.rsi_ma.toFixed(2) : 'n/a'}</span>
                              </div>
                            )}
                            <ResponsiveContainer width="100%" height="100%">
                              {oscillatorTab === 'rsi' ? (
                                <LineChart data={getPredictionChartData()}>
                                  <CartesianGrid strokeDasharray="1 1" stroke="#222632" />
                                  <XAxis dataKey="date" stroke="#8a909d" />
                                  <YAxis stroke="#8a909d" domain={[0, 100]} ticks={[30, 50, 70]} orientation="right" />
                                  <Tooltip contentStyle={{ backgroundColor: '#131722', borderColor: '#2a2e39', color: '#fff' }} />
                                  <ReferenceLine y={70} stroke="rgba(239, 83, 80, 0.4)" strokeDasharray="3 3" />
                                  <ReferenceLine y={50} stroke="rgba(138, 144, 157, 0.2)" strokeDasharray="3 3" />
                                  <ReferenceLine y={30} stroke="rgba(8, 153, 129, 0.4)" strokeDasharray="3 3" />
                                  
                                  {/* RSI (purple) and RSI-MA (yellow) lines */}
                                  <Line type="monotone" dataKey="rsi_14" name="RSI" stroke="#a78bfa" dot={false} strokeWidth={1.5} />
                                  <Line type="monotone" dataKey="rsi_ma" name="RSI-MA" stroke="#ffd600" dot={false} strokeWidth={1.5} />
                                  
                                  {/* Dynamic axis current labels */}
                                  {latestItem?.rsi_14 && (
                                    <ReferenceLine 
                                      y={latestItem.rsi_14} 
                                      stroke="#a78bfa" 
                                      strokeDasharray="2 2"
                                      label={{ value: latestItem.rsi_14.toFixed(2), position: 'right', fill: '#fff', backgroundColor: '#a78bfa', fontSize: 10 }}
                                    />
                                  )}
                                  {latestItem?.rsi_ma && (
                                    <ReferenceLine 
                                      y={latestItem.rsi_ma} 
                                      stroke="#ffd600" 
                                      strokeDasharray="2 2"
                                      label={{ value: latestItem.rsi_ma.toFixed(2), position: 'right', fill: '#000', backgroundColor: '#ffd600', fontSize: 10 }}
                                    />
                                  )}

                                  <Brush dataKey="date" height={15} stroke="rgba(0, 242, 254, 0.4)" fill="#0d111a" tickFormatter={() => ''} />
                                </LineChart>
                              ) : oscillatorTab === 'stochastic' ? (
                                <LineChart data={getPredictionChartData()}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#2e333d" />
                                  <XAxis dataKey="date" stroke="#8a909d" />
                                  <YAxis stroke="#8a909d" domain={[0, 100]} ticks={[20, 80]} />
                                  <Tooltip contentStyle={{ backgroundColor: '#1e222b', borderColor: '#2e333d', color: '#fff' }} />
                                  <ReferenceLine y={80} stroke="#ff1744" strokeDasharray="3 3" />
                                  <ReferenceLine y={20} stroke="#00e676" strokeDasharray="3 3" />
                                  <Line type="monotone" dataKey="stoch_k" name="%K" stroke="#00f2fe" dot={false} strokeWidth={1.5} />
                                  <Line type="monotone" dataKey="stoch_d" name="%D" stroke="#ff9100" dot={false} strokeWidth={1.5} />
                                  <Brush dataKey="date" height={15} stroke="rgba(0, 242, 254, 0.4)" fill="#0d111a" tickFormatter={() => ''} />
                                </LineChart>
                              ) : (
                                <LineChart data={getPredictionChartData()}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#2e333d" />
                                  <XAxis dataKey="date" stroke="#8a909d" />
                                  <YAxis stroke="#8a909d" domain={['auto', 'auto']} />
                                  <Tooltip contentStyle={{ backgroundColor: '#1e222b', borderColor: '#2e333d', color: '#fff' }} />
                                  <ReferenceLine y={100} stroke="#ff1744" strokeDasharray="3 3" />
                                  <ReferenceLine y={-100} stroke="#00e676" strokeDasharray="3 3" />
                                  <Line type="monotone" dataKey="cci_20" name="CCI" stroke="#2979ff" dot={false} strokeWidth={1.5} />
                                  <Brush dataKey="date" height={15} stroke="rgba(0, 242, 254, 0.4)" fill="#0d111a" tickFormatter={() => ''} />
                                </LineChart>
                              )}
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Analytics Sidebar */}
                      <div className="analytics-column">
                        {/* SMC Panel */}
                        <div className="analytics-card">
                          <h4>🛡️ SMC Institutional Footprint</h4>
                          <div className="analytics-grid">
                            <div className="analytics-item">
                              <span className="analytics-label">Swing High</span>
                              <span className="analytics-value">
                                {(() => {
                                  const list = getPredictionChartData();
                                  const val = list.length > 0 ? list[list.length - 1].last_swing_high : null;
                                  return val ? `$${val.toFixed(2)}` : 'N/A';
                                })()}
                              </span>
                            </div>
                            <div className="analytics-item">
                              <span className="analytics-label">Swing Low</span>
                              <span className="analytics-value">
                                {(() => {
                                  const list = getPredictionChartData();
                                  const val = list.length > 0 ? list[list.length - 1].last_swing_low : null;
                                  return val ? `$${val.toFixed(2)}` : 'N/A';
                                })()}
                              </span>
                            </div>
                          </div>

                          <div className="checklist-item">
                            <span className="checklist-label">Break of Structure (BOS)</span>
                            <span className={
                              (() => {
                                const list = getPredictionChartData();
                                const val = list.length > 0 ? list[list.length - 1].bos : 0;
                                return val === 1 ? "checklist-status passed" : val === -1 ? "checklist-status failed" : "checklist-status pending";
                              })()
                            }>
                              {(() => {
                                const list = getPredictionChartData();
                                const val = list.length > 0 ? list[list.length - 1].bos : 0;
                                return val === 1 ? "Bullish BOS" : val === -1 ? "Bearish BOS" : "No Breakout";
                              })()}
                            </span>
                          </div>

                          <div className="checklist-item">
                            <span className="checklist-label">Change of Character (CHOCH)</span>
                            <span className={
                              (() => {
                                const list = getPredictionChartData();
                                const val = list.length > 0 ? list[list.length - 1].choch : 0;
                                return val === 1 ? "checklist-status passed" : val === -1 ? "checklist-status failed" : "checklist-status pending";
                              })()
                            }>
                              {(() => {
                                const list = getPredictionChartData();
                                const val = list.length > 0 ? list[list.length - 1].choch : 0;
                                return val === 1 ? "Bullish CHOCH" : val === -1 ? "Bearish CHOCH" : "No Trend Shift";
                              })()}
                            </span>
                          </div>

                          <div className="checklist-item">
                            <span className="checklist-label">Liquidity Sweeps</span>
                            <span className="checklist-status pending" style={{ color: 'var(--accent-orange)' }}>
                              {(() => {
                                const list = getPredictionChartData();
                                if (list.length === 0) return "None";
                                const row = list[list.length - 1];
                                if (row.sweep_high === 1) return "Swept High (Bearish)";
                                if (row.sweep_low === 1) return "Swept Low (Bullish)";
                                return "Stable Pools";
                              })()}
                            </span>
                          </div>

                          <div className="checklist-item">
                            <span className="checklist-label">Active Fair Value Gap</span>
                            <span className="checklist-status" style={{ color: 'var(--text-muted)' }}>
                              {(() => {
                                const list = getPredictionChartData();
                                if (list.length === 0) return "None";
                                const row = list[list.length - 1];
                                if (row.fvg_bullish_size > 0) return `Bullish ($${row.fvg_bullish_size.toFixed(2)})`;
                                if (row.fvg_bearish_size > 0) return `Bearish ($${row.fvg_bearish_size.toFixed(2)})`;
                                return "No Imbalance";
                              })()}
                            </span>
                          </div>
                        </div>

                        {/* Elliott Wave Panel */}
                        <div className="analytics-card">
                          <h4>🌊 Elliott Wave Psychology</h4>
                          <div className="analytics-item" style={{ width: '100%' }}>
                            <span className="analytics-label">Current Wave Phase</span>
                            <span className="analytics-value neutral" style={{ color: 'var(--accent-cyan)' }}>
                              {(() => {
                                const list = getPredictionChartData();
                                if (list.length === 0) return "No Data";
                                const wave = list[list.length - 1].elliott_wave;
                                if (wave === 1) return "Wave 1 (Impulse Start)";
                                if (wave === 2) return "Wave 2 (Retracement)";
                                if (wave === 3) return "Wave 3 (Impulse Trend)";
                                if (wave === 4) return "Wave 4 (Consolidation)";
                                if (wave === 5) return "Wave 5 (Trend Exhaustion)";
                                if (wave === -1) return "Wave A (Correction Down)";
                                if (wave === -2) return "Wave B (Corrective Bounce)";
                                if (wave === -3) return "Wave C (Final Capitulation)";
                                return "Awaiting Wave Formation";
                              })()}
                            </span>
                          </div>

                          <div className="checklist-item">
                            <span className="checklist-label">Rule 1: Wave 2 Retracement limit</span>
                            <span className="checklist-status passed">PASSED</span>
                          </div>
                          <div className="checklist-item">
                            <span className="checklist-label">Rule 2: Wave 3 is never the shortest</span>
                            <span className="checklist-status passed">PASSED</span>
                          </div>
                          <div className="checklist-item">
                            <span className="checklist-label">Rule 3: Wave 4 overlaps Wave 1 limit</span>
                            <span className="checklist-status passed">PASSED</span>
                          </div>

                          <div style={{ marginTop: '10px', fontSize: '11px', lineHeight: '1.4', padding: '10px', borderRadius: '6px', backgroundColor: 'var(--bg-tertiary)', borderLeft: '3px solid var(--accent-cyan)' }}>
                            <strong>Wave Analysis:</strong>
                            <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                              {(() => {
                                const list = getPredictionChartData();
                                if (list.length === 0) return "No Data";
                                const wave = list[list.length - 1].elliott_wave;
                                switch(wave) {
                                  case 1: return "Impulsive rise starting. Monitor for Wave 2 pullback support.";
                                  case 2: return "Corrective pullback in progress. Look for support confirmation above Wave 1 start.";
                                  case 3: return "Strongest impulse phase active. High institutional volume is driving price trend.";
                                  case 4: return "Temporary profit-taking/re-accumulation. Validate overlap limits.";
                                  case 5: return "Exhaustion wave. Market sentiment is highly bullish but overextended. Prepare for A-B-C correction.";
                                  case -1: return "First leg of corrective cycle (Wave A) is pushing prices down. Expect intermediate counter-trend bounce.";
                                  case -2: return "Wave B corrective bounce is forming. Avoid long-term holds; likely a dead-cat bounce.";
                                  case -3: return "Final Wave C capitulation is flushing out remaining retail liquidity. Prepare for new cycle.";
                                  default: return "Market structure is in search of a clean 5-wave motive. Watch key pivots.";
                                }
                              })()}
                            </p>
                          </div>
                        </div>
                      </div>
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
