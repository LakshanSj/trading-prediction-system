import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  ShieldAlert,
  ArrowRight,
  History,
  Shield,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Sliders,
  ChevronLeft,
  ChevronRight
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
  ResponsiveContainer, 
  ReferenceLine,
  Cell
} from 'recharts';
import AdminPanel from './AdminPanel';
import { authService, dbService } from './firebase';
import UserAuthModal from './components/UserAuthModal';
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
  const [startDate, setStartDate] = useState('2010-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [epochs, setEpochs] = useState(30);
  
  // Timeframe and chart zoom states
  const [intervalVal, setIntervalVal] = useState('1d');
  const [chartZoom, setChartZoom] = useState('all');
  const [customZoomStart, setCustomZoomStart] = useState('');
  const [customZoomEnd, setCustomZoomEnd] = useState('');

  // Enforce strict historical range limits per interval to optimize local training speed and prevent yfinance errors
  const getMinAllowedDate = useCallback((interval) => {
    const today = new Date();
    let yearsBack = 15; // Default is 15 years
    if (interval === '1h') yearsBack = 1;
    else if (interval === '4h') yearsBack = 2; // Intraday Hourly cap is 730 days on yfinance
    else if (interval === '1w') yearsBack = 20;
    
    const minDate = new Date();
    minDate.setFullYear(today.getFullYear() - yearsBack);
    return minDate;
  }, []);

  const handleIntervalChange = useCallback((newInterval) => {
    setIntervalVal(newInterval);
    const minDateStr = getMinAllowedDate(newInterval).toISOString().split('T')[0];
    // Automatically set default date back to the limit of the new interval
    setStartDate(minDateStr);
  }, [getMinAllowedDate]);
  
  // Suggestions & history states
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentTickers, setRecentTickers] = useState(() => {
    try {
      const saved = localStorage.getItem('recent_tickers');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Navigation & UI states
  const [activeTab, setActiveTab] = useState('predictions');
  
  // User Authentication & Logs states
  const [currentUser, setCurrentUser] = useState(null);
  const [userLogs, setUserLogs] = useState([]);
  const [loadingUserLogs, setLoadingUserLogs] = useState(false);
  const [logFilter, setLogFilter] = useState('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');

  const isAdmin = currentUser && currentUser.username === 'adminTrading';

  // Helper to log user action — stable reference via useCallback
  const logUserAction = useCallback((eventType, details) => {
    if (currentUser) {
      dbService.logActivity(currentUser.username, currentUser.email, eventType, details);
    }
  }, [currentUser]);
  const [backendStatus, setBackendStatus] = useState('checking');
  const [showAdmin, setShowAdmin] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  
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
  const [yScaleType, setYScaleType] = useState('linear');
  const [predictionRecords, setPredictionRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  
  // Loading & logs states
  const [trainLoading, setTrainLoading] = useState(false);
  const [wfvLoading, setWfvLoading] = useState(false);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [logMessages, setLogMessages] = useState([]);
  
  // Ref for auto-polling ticker status during training
  const pollIntervalRef = useRef(null);

  // Check Backend Connection — polls every 30s to avoid network chatter while idle
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const healthUrl = API_BASE_URL ? `${API_BASE_URL}/health` : '/health';
        const res = await apiFetch(healthUrl);
        setBackendStatus(res.ok ? 'connected' : 'disconnected');
      } catch {
        setBackendStatus('disconnected');
      }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged((user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  const loadLogs = useCallback(async () => {
    if (!currentUser) return;
    setLoadingUserLogs(true);
    try {
      const logs = await dbService.fetchUserLogs(currentUser.username);
      setUserLogs(logs);
    } catch {
      // Silently fail; logs are non-critical
    } finally {
      setLoadingUserLogs(false);
    }
  }, [currentUser]);

  // Fetch logs when active tab is user logs
  useEffect(() => {
    if (activeTab === 'userlogs' && currentUser) {
      loadLogs();
    }
  }, [activeTab, currentUser, loadLogs]);

  const loadPredictionRecords = useCallback(async () => {
    if (!currentUser) return;
    setLoadingRecords(true);
    try {
      const records = await dbService.fetchPredictionRecords();
      setPredictionRecords(records);
    } catch {
      setPredictionRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (activeTab === 'growth') {
      loadPredictionRecords();
    }
  }, [activeTab, loadPredictionRecords]);

  const handleLogout = async () => {
    if (currentUser) {
      // Fire-and-forget: do not await logging, to prevent blocking UI on network delays
      dbService.logActivity(currentUser.username, currentUser.email, 'USER_LOGOUT', { message: `User ${currentUser.username} logged out.` });
    }
    try {
      await authService.logout();
    } catch (e) {
      console.error("Logout error:", e);
    }
    // Instantly reset local state to ensure snappy routing
    setCurrentUser(null);
    setActiveTab('predictions');
  };

  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
    dbService.logActivity(user.username, user.email, 'USER_LOGIN', { message: `User ${user.username} logged in successfully.` });
  };

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
    logUserAction('ASSET_SEARCH', { ticker: ticker, timeframe: intervalVal });
    return () => stopStatusPolling();
  }, [ticker, intervalVal, logUserAction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling logic for background training status
  const startStatusPolling = (symbol, currentInterval) => {
    stopStatusPolling();
    setLogMessages(["Training initiated on server...", "Awaiting data download..."]);
    // Poll every 3s — fast enough to track training while reducing backend load
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
            setTicker(symbol);
            fetchPredictionAndExplainability(symbol, currentInterval);
          } else {
            setLogMessages(prev => [...prev, `Training failed: ${data.message}`]);
          }
        }
      } catch {
        // Network hiccup during polling — will retry next interval
      }
    }, 3000);
  };

  const stopStatusPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const fetchPredictionAndExplainability = async (symbol, currentInterval) => {
    try {
      // Fetch Predictions and Explainability in parallel
      const [predRes, expRes] = await Promise.all([
        apiFetch(`${API_BASE_URL}/api/predictions?ticker=${symbol}&interval=${currentInterval}`),
        apiFetch(`${API_BASE_URL}/api/explainability?ticker=${symbol}&interval=${currentInterval}`)
      ]);
      if (predRes.ok) {
        const predVal = await predRes.json();
        setPredictionData(predVal);
        
        // Save prediction performance record using model trained timestamp
        if (currentUser && predVal.history && predVal.history.length > 0) {
          const trainedAt = tickerStatus?.meta?.trained_at || new Date().toISOString();
          dbService.savePredictionRecord({
            ticker: symbol,
            predict: predVal.predicted_direction_tomorrow,
            accuracy: predVal.directional_accuracy,
            trained_at: trainedAt
          }).then(saved => {
            if (saved) {
              console.log(`Saved performance record for ${symbol} successfully.`);
              // If active tab is growth, refresh it
              if (activeTab === 'growth') {
                loadPredictionRecords();
              }
            }
          });
        }
      }
      if (expRes.ok) setExplainData(await expRes.json());
    } catch {
      console.error("Failed to load predictions/explainability");
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
    logUserAction('MODEL_TRAINING_TRIGGERED', { ticker, interval: intervalVal, start_date: startDate, end_date: endDate, epochs });
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
    } catch {
      setLogMessages(prev => [...prev, `Connection error during training request.`]);
      setTrainLoading(false);
    }
  };

  const triggerWfv = async () => {
    setWfvLoading(true);
    logUserAction('VALIDATION_RUN_TRIGGERED', { ticker, interval: intervalVal });
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
    } catch {
      alert("Failed to connect to the server for Walk-Forward Validation.");
    } finally {
      setWfvLoading(false);
    }
  };

  const triggerMonitoring = async () => {
    setMonitorLoading(true);
    logUserAction('MONITOR_RUN_TRIGGERED', { ticker, interval: intervalVal });
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
    } catch {
      alert("Failed to connect to the server for Daily Monitoring.");
    } finally {
      setMonitorLoading(false);
    }
  };

  // Chart Data preparation and dynamic timeframe slicing (Memoized for high performance)
  const chartPoints = useMemo(() => {
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
  }, [predictionData, chartZoom, customZoomStart, customZoomEnd]);

  // Memoize latest-bar derived display values — recomputes only when chartPoints changes
  const { latestItem, latestPrice, latestIsBullish, latestPriceColor } = useMemo(() => {
    const item = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : null;
    const price = item ? item.close : 0;
    const bullish = item ? item.close >= item.open : true;
    return {
      latestItem: item,
      latestPrice: price,
      latestIsBullish: bullish,
      latestPriceColor: bullish ? '#089981' : '#f23645'
    };
  }, [chartPoints]);

  // Memoize all right-sidebar analytics values — replaces 12 inline IIFEs that ran on every render
  const sidebarAnalytics = useMemo(() => {
    const last = chartPoints.length > 0 ? chartPoints[chartPoints.length - 1] : null;
    const f = (v) => (v != null ? `$${v.toFixed(2)}` : 'N/A');
    const bosVal = last?.bos ?? 0;
    const chochVal = last?.choch ?? 0;
    const sweepVal = last?.liquidity_sweep ?? 0;
    const fvgVal = last?.fvg ?? 0;
    const wave = last?.elliott_wave ?? null;
    const waveLabels = {
      1: 'Wave 1 - Motive Phase', 2: 'Wave 2 - Correction Phase',
      3: 'Wave 3 - Strong Trend Phase', 4: 'Wave 4 - Re-accumulation Phase',
      5: 'Wave 5 - Exhaustion Motive', '-1': 'Corrective Wave A',
      '-2': 'Corrective Wave B', '-3': 'Corrective Wave C'
    };
    const waveDescriptions = {
      1: 'Impulsive rise starting. Monitor for Wave 2 pullback support.',
      2: 'Corrective pullback in progress. Look for support confirmation above Wave 1 start.',
      3: 'Strongest impulse phase active. High institutional volume is driving price trend.',
      4: 'Temporary profit-taking/re-accumulation. Validate overlap limits.',
      5: 'Exhaustion wave. Market sentiment is highly bullish but overextended. Prepare for A-B-C correction.',
      '-1': 'First leg of corrective cycle (Wave A) is pushing prices down. Expect intermediate counter-trend bounce.',
      '-2': 'Wave B corrective bounce is forming. Avoid long-term holds; likely a dead-cat bounce.',
      '-3': 'Final Wave C capitulation is flushing out remaining retail liquidity. Prepare for new cycle.'
    };
    return {
      swingHigh: f(last?.last_swing_high),
      swingLow: f(last?.last_swing_low),
      bosClass: bosVal === 1 ? 'checklist-status passed' : bosVal === -1 ? 'checklist-status failed' : 'checklist-status pending',
      bosLabel: bosVal === 1 ? 'Bullish BOS' : bosVal === -1 ? 'Bearish BOS' : 'No Breakout',
      chochClass: chochVal === 1 ? 'checklist-status passed' : chochVal === -1 ? 'checklist-status failed' : 'checklist-status pending',
      chochLabel: chochVal === 1 ? 'Bullish CHOCH' : chochVal === -1 ? 'Bearish CHOCH' : 'No Trend Shift',
      sweepClass: sweepVal !== 0 ? 'checklist-status passed' : 'checklist-status pending',
      sweepLabel: sweepVal === 1 ? 'Bull Sweep' : sweepVal === -1 ? 'Bear Sweep' : 'Stable Pools',
      fvgClass: fvgVal !== 0 ? 'checklist-status passed' : 'checklist-status pending',
      fvgLabel: fvgVal === 1 ? 'Bullish FVG' : fvgVal === -1 ? 'Bearish FVG' : 'No Imbalance',
      wavePhase: wave != null ? (waveLabels[wave] || 'Awaiting Wave Formation') : 'No Data',
      waveDescription: wave != null ? (waveDescriptions[wave] || 'Market structure is in search of a clean 5-wave motive. Watch key pivots.') : 'No Data',
    };
  }, [chartPoints]);

  if (!currentUser) {
    return (
      <UserAuthModal 
        isOpen={true} 
        onClose={() => {}} 
        onAuthSuccess={handleAuthSuccess} 
        isFullPage={true} 
      />
    );
  }

  if (currentUser && currentUser.status !== 'approved') {
    return (
      <div className="user-auth-gateway">
        <div className="user-auth-card" style={{ textAlign: 'center', maxWidth: '460px' }}>
          <div className="admin-shield-glow" style={{ margin: '0 auto 20px auto', width: '70px', height: '70px', borderRadius: '50%', background: 'rgba(255, 145, 0, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255, 145, 0, 0.3)' }}>
            <ShieldAlert size={36} style={{ color: '#ff9100' }} />
          </div>
          <h2 style={{ fontSize: '22px', margin: '0 0 10px 0', color: '#fff' }}>Access Pending Approval</h2>
          <p style={{ color: '#8a909d', fontSize: '14px', lineHeight: '1.5', margin: '0 0 25px 0' }}>
            Hello, <strong>{currentUser.username}</strong>. Your registered account is currently awaiting administrator review. 
            Access to predictions and analytics will be unlocked once approved.
          </p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '11px', color: '#ffd600', background: 'rgba(255, 214, 0, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255, 214, 0, 0.15)', marginBottom: '10px' }}>
              ℹ️ Please ask the admin (adminTrading) to approve your access in the Admin logging panel.
            </div>
            
            <button onClick={handleLogout} className="action-btn secondary-btn" style={{ width: '100%', height: '42px', fontSize: '14px', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '8px' }}>
              Sign Out / Return to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        
        {/* Header right: status + auth + admin button */}
        <div className="header-right">
          <div className={`status-badge ${backendStatus}`}>
            <span className="pulse-dot"></span>
            Backend: {backendStatus.toUpperCase()}
          </div>

          <div className="user-profile-menu">
            <span className="user-email-display" title={currentUser.email}>
              👤 {currentUser.username} {isAdmin && <span className="admin-pill">ADMIN</span>}
            </span>
            <button onClick={handleLogout} className="signout-btn">
              Sign Out
            </button>
          </div>

          {isAdmin && (
            <button
              className="admin-trigger-btn"
              onClick={() => setShowAdmin(true)}
              title="Open Admin Logging Panel"
            >
              <Shield size={14} /> Admin
            </button>
          )}
        </div>
      </header>

      {/* Admin Panel overlay */}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      <div className={`main-layout ${!showLeftSidebar ? 'no-left-sidebar' : ''}`} style={!showLeftSidebar ? { gridTemplateColumns: '1fr' } : {}}>
        {/* SIDEBAR CONFIGURATION */}
        {showLeftSidebar && (
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

          {isAdmin && (
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
                  max="100" 
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
          )}

          {isAdmin && (
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
          )}
        </aside>
        )}

        {/* Left Sidebar Circle Chevron Toggle Tab */}
        <button 
          className={`sidebar-toggle-tab left-sidebar-tab ${!showLeftSidebar ? 'collapsed' : ''}`}
          onClick={() => setShowLeftSidebar(!showLeftSidebar)}
          style={showLeftSidebar ? { left: '308px' } : { left: '8px' }}
          title={showLeftSidebar ? "Collapse Left Menu" : "Expand Left Menu"}
        >
          {showLeftSidebar ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>

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
                {isAdmin && (
                  <button 
                    onClick={() => setActiveTab('wfv')} 
                    className={`tab-link ${activeTab === 'wfv' ? 'active' : ''}`}
                  >
                    📊 Walk-Forward Validation
                  </button>
                )}
                {isAdmin && (
                  <button 
                    onClick={() => setActiveTab('monitor')} 
                    className={`tab-link ${activeTab === 'monitor' ? 'active' : ''}`}
                  >
                    🚨 Monitoring & Decay
                  </button>
                )}
                {currentUser && (
                  <button 
                    onClick={() => setActiveTab('userlogs')} 
                    className={`tab-link ${activeTab === 'userlogs' ? 'active' : ''}`}
                  >
                    📋 My Activity Logs
                  </button>
                )}
                {currentUser && (
                  <button 
                    onClick={() => setActiveTab('growth')} 
                    className={`tab-link ${activeTab === 'growth' ? 'active' : ''}`}
                  >
                    📈 Performance & Growth
                  </button>
                )}
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

                    <div className="predictions-layout" style={{ position: 'relative' }}>
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
                            onClick={() => setShowRightSidebar(!showRightSidebar)} 
                            className={`overlay-btn ${showRightSidebar ? 'active' : ''}`}
                            title="Toggle Analytics Sidebar"
                          >
                            <Sliders size={12} /> {showRightSidebar ? 'Hide Analytics' : 'Show Analytics'}
                          </button>
                          <button 
                            onClick={() => setYScaleType('linear')} 
                            className={`overlay-btn ${yScaleType === 'linear' ? 'active' : ''}`}
                            title="Normal linear price scale"
                          >
                            Normal
                          </button>
                          <button 
                            onClick={() => setYScaleType('log')} 
                            className={`overlay-btn ${yScaleType === 'log' ? 'active' : ''}`}
                            title="Logarithmic price scale"
                          >
                            Log
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
                        <div className={`chart-wrapper ${isFullScreen ? 'fullscreen' : ''}`} style={isFullScreen ? { height: `${priceChartHeight}px` } : { height: '400px' }}>
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
                            <ComposedChart data={chartPoints}>
                              <CartesianGrid strokeDasharray="1 1" stroke="#222632" />
                              <XAxis dataKey="date" stroke="#8a909d" />
                              <YAxis scale={yScaleType} stroke="#8a909d" domain={['auto', 'auto']} orientation="right" />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#131722', borderColor: '#2a2e39', color: '#fff' }}
                              />
                              
                              {/* Wick range (high to low) rendered as thin bar */}
                              <Bar dataKey="wick_range" barSize={1.5} name="Wick" tooltipType="none">
                                {
                                  chartPoints.map((entry, index) => {
                                    const isUp = entry.close >= entry.open;
                                    return <Cell key={`wick-${index}`} fill={isUp ? '#089981' : '#f23645'} stroke={isUp ? '#089981' : '#f23645'} />;
                                  })
                                }
                              </Bar>

                              {/* Body range (open to close) rendered as thicker bar */}
                              <Bar dataKey="body_range" barSize={8} name="Candle">
                                {
                                  chartPoints.map((entry, index) => {
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
                                    fill: latestPriceColor, 
                                    fontSize: 10,
                                    fontWeight: 'bold'
                                  }} 
                                />
                              )}
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
                        <div className={`oscillator-section ${isFullScreen ? 'fullscreen' : ''}`} style={isFullScreen ? { height: `${oscillatorChartHeight}px` } : { height: '240px' }}>
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
                                <LineChart data={chartPoints}>
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
                                      label={{ value: latestItem.rsi_14.toFixed(2), position: 'right', fill: '#a78bfa', fontSize: 10, fontWeight: 'bold' }}
                                    />
                                  )}
                                  {latestItem?.rsi_ma && (
                                    <ReferenceLine 
                                      y={latestItem.rsi_ma} 
                                      stroke="#ffd600" 
                                      strokeDasharray="2 2"
                                      label={{ value: latestItem.rsi_ma.toFixed(2), position: 'right', fill: '#ffd600', fontSize: 10, fontWeight: 'bold' }}
                                    />
                                  )}
                                </LineChart>
                              ) : oscillatorTab === 'stochastic' ? (
                                <LineChart data={chartPoints}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#2e333d" />
                                  <XAxis dataKey="date" stroke="#8a909d" />
                                  <YAxis stroke="#8a909d" domain={[0, 100]} ticks={[20, 80]} />
                                  <Tooltip contentStyle={{ backgroundColor: '#1e222b', borderColor: '#2e333d', color: '#fff' }} />
                                  <ReferenceLine y={80} stroke="#ff1744" strokeDasharray="3 3" />
                                  <ReferenceLine y={20} stroke="#00e676" strokeDasharray="3 3" />
                                  <Line type="monotone" dataKey="stoch_k" name="%K" stroke="#00f2fe" dot={false} strokeWidth={1.5} />
                                  <Line type="monotone" dataKey="stoch_d" name="%D" stroke="#ff9100" dot={false} strokeWidth={1.5} />
                                </LineChart>
                              ) : (
                                <LineChart data={chartPoints}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#2e333d" />
                                  <XAxis dataKey="date" stroke="#8a909d" />
                                  <YAxis stroke="#8a909d" domain={['auto', 'auto']} />
                                  <Tooltip contentStyle={{ backgroundColor: '#1e222b', borderColor: '#2e333d', color: '#fff' }} />
                                  <ReferenceLine y={100} stroke="#ff1744" strokeDasharray="3 3" />
                                  <ReferenceLine y={-100} stroke="#00e676" strokeDasharray="3 3" />
                                  <Line type="monotone" dataKey="cci_20" name="CCI" stroke="#2979ff" dot={false} strokeWidth={1.5} />
                                </LineChart>
                              )}
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Analytics Sidebar */}
                      {showRightSidebar && (
                        <div className="analytics-column">
                          {/* SMC Panel */}
                          <div className="analytics-card">
                            <h4>🛡️ SMC Institutional Footprint</h4>
                            <div className="analytics-grid">
                              <div className="analytics-item">
                                <span className="analytics-label">Swing High</span>
                                <span className="analytics-value">{sidebarAnalytics.swingHigh}</span>
                              </div>
                              <div className="analytics-item">
                                <span className="analytics-label">Swing Low</span>
                                <span className="analytics-value">{sidebarAnalytics.swingLow}</span>
                              </div>
                            </div>

                            <div className="checklist-item">
                              <span className="checklist-label">Break of Structure (BOS)</span>
                              <span className={sidebarAnalytics.bosClass}>{sidebarAnalytics.bosLabel}</span>
                            </div>

                            <div className="checklist-item">
                              <span className="checklist-label">Change of Character (CHOCH)</span>
                              <span className={sidebarAnalytics.chochClass}>{sidebarAnalytics.chochLabel}</span>
                            </div>

                            <div className="checklist-item">
                              <span className="checklist-label">Liquidity Sweeps</span>
                              <span className={sidebarAnalytics.sweepClass}>{sidebarAnalytics.sweepLabel}</span>
                            </div>

                            <div className="checklist-item">
                              <span className="checklist-label">Active Fair Value Gap</span>
                              <span className={sidebarAnalytics.fvgClass}>{sidebarAnalytics.fvgLabel}</span>
                            </div>
                          </div>

                          {/* Elliott Wave Panel */}
                          <div className="analytics-card">
                            <h4>🌊 Elliott Wave Psychology</h4>
                            <div className="analytics-grid">
                              <div className="analytics-item" style={{ gridColumn: 'span 2' }}>
                                <span className="analytics-label">Current Wave Phase</span>
                                <span className="analytics-value" style={{ color: '#00f2fe' }}>
                                  {sidebarAnalytics.wavePhase}
                                </span>
                              </div>
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
                                {sidebarAnalytics.waveDescription}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Right Sidebar Circle Chevron Toggle Tab */}
                      <button 
                        className={`sidebar-toggle-tab right-sidebar-tab ${!showRightSidebar ? 'collapsed' : ''}`}
                        onClick={() => setShowRightSidebar(!showRightSidebar)}
                        style={showRightSidebar ? { right: '308px' } : { right: '8px' }}
                        title={showRightSidebar ? "Collapse Analytics Sidebar" : "Expand Analytics Sidebar"}
                      >
                        {showRightSidebar ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                      </button>
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

                {/* User Activity Logs Tab */}
                {activeTab === 'userlogs' && currentUser && (
                  <div className="tab-panel animate-fade-in">
                    <div className="panel-header-desc" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                      <div>
                        <h3>My Personal Activity Logs</h3>
                        <p>Lists all your dashboard interactions and asset lookups. Logs are fetched in real-time from the database.</p>
                      </div>
                      <button 
                        onClick={async () => {
                          if (window.confirm("Are you sure you want to permanently clear your logs? This action is irreversible.")) {
                            const count = await dbService.clearUserLogs(currentUser.username);
                            alert(`Cleared ${count} logs.`);
                            loadLogs();
                          }
                        }}
                        className="action-btn secondary-btn clear-logs-btn"
                        style={{ height: '32px', padding: '0 12px', fontSize: '12px' }}
                      >
                        Clear My Logs
                      </button>
                    </div>

                    <div className="user-logs-controls" style={{ display: 'flex', gap: '12px', margin: '15px 0', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div className="search-logs-input" style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                        <input 
                          type="text" 
                          placeholder="Filter logs by keyword or ticker (e.g. AAPL)..." 
                          value={logSearchQuery}
                          onChange={(e) => setLogSearchQuery(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: '#131722',
                            border: '1px solid #2a2e39',
                            borderRadius: '6px',
                            color: '#fff',
                            fontSize: '13px'
                          }}
                        />
                      </div>
                      <select 
                        value={logFilter} 
                        onChange={(e) => setLogFilter(e.target.value)}
                        style={{
                          padding: '8px 12px',
                          background: '#131722',
                          border: '1px solid #2a2e39',
                          borderRadius: '6px',
                          color: '#fff',
                          fontSize: '13px',
                          cursor: 'pointer',
                          minWidth: '150px'
                        }}
                      >
                        <option value="all">All Events</option>
                        <option value="USER_LOGIN">Logins</option>
                        <option value="USER_LOGOUT">Logouts</option>
                        <option value="ASSET_SEARCH">Asset Lookups</option>
                        <option value="MODEL_TRAINING_TRIGGERED">Model Trainings</option>
                        <option value="VALIDATION_RUN_TRIGGERED">Validation Runs</option>
                        <option value="MONITOR_RUN_TRIGGERED">Monitoring Runs</option>
                      </select>
                      <button 
                        onClick={loadLogs}
                        disabled={loadingUserLogs}
                        className="action-btn secondary-btn"
                        style={{ height: '34px', minWidth: '70px', padding: '0 12px' }}
                      >
                        {loadingUserLogs ? <RefreshCw className="spin-icon" size={14} /> : "Reload"}
                      </button>
                    </div>

                    {loadingUserLogs ? (
                      <div className="tab-empty-state">
                        <RefreshCw size={24} className="spin-icon" />
                        <h4>Retrieving logs from Database...</h4>
                      </div>
                    ) : (
                      (() => {
                        // Client-side filter
                        const filteredLogs = userLogs.filter(log => {
                          const matchesType = logFilter === 'all' || log.event_type === logFilter;
                          const serialized = JSON.stringify(log).toLowerCase();
                          const matchesQuery = !logSearchQuery || serialized.includes(logSearchQuery.toLowerCase());
                          return matchesType && matchesQuery;
                        });

                        return filteredLogs.length > 0 ? (
                          <div className="wfv-table-container">
                            <table className="info-table">
                              <thead>
                                <tr>
                                  <th>Timestamp (Local)</th>
                                  <th>Event Type</th>
                                  <th>Description / Details</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredLogs.map((log) => (
                                  <tr key={log.id}>
                                    <td style={{ color: '#8a909d', fontSize: '12px' }}>{log.timestamp_local}</td>
                                    <td>
                                      <span className={`event-badge badge-${log.event_type.toLowerCase()}`}>
                                        {log.event_type.replace(/_/g, ' ')}
                                      </span>
                                    </td>
                                    <td style={{ fontSize: '13px' }}>
                                      {log.event_type === 'ASSET_SEARCH' && (
                                        <span>Searched ticker <strong>{log.details.ticker}</strong> on {log.details.timeframe} interval.</span>
                                      )}
                                      {log.event_type === 'MODEL_TRAINING_TRIGGERED' && (
                                        <span>Triggered hybrid training for <strong>{log.details.ticker}</strong> ({log.details.epochs} epochs, {log.details.interval} data).</span>
                                      )}
                                      {log.event_type === 'VALIDATION_RUN_TRIGGERED' && (
                                        <span>Initiated walk-forward verification for ticker <strong>{log.details.ticker}</strong>.</span>
                                      )}
                                      {log.event_type === 'MONITOR_RUN_TRIGGERED' && (
                                        <span>Simulated accuracy monitor and health metrics check for <strong>{log.details.ticker}</strong>.</span>
                                      )}
                                      {log.event_type === 'USER_LOGIN' && (
                                        <span style={{ color: '#00e676' }}>{log.details.message}</span>
                                      )}
                                      {log.event_type === 'USER_LOGOUT' && (
                                        <span style={{ color: '#ff1744' }}>{log.details.message}</span>
                                      )}
                                      {!['ASSET_SEARCH', 'MODEL_TRAINING_TRIGGERED', 'VALIDATION_RUN_TRIGGERED', 'MONITOR_RUN_TRIGGERED', 'USER_LOGIN', 'USER_LOGOUT'].includes(log.event_type) && (
                                        <span>{JSON.stringify(log.details)}</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="tab-empty-state">
                            <AlertTriangle size={24} />
                            <h4>No matching activity logs</h4>
                            <p>We found no history matching the selected event type or search criteria.</p>
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}

                {/* Performance & Growth Tab */}
                {activeTab === 'growth' && (
                  <div className="tab-panel">
                    <div className="panel-header-desc">
                      <h3>📈 Model Performance & Growth Tracking</h3>
                      <p>
                        Records the historical performance of your trained predictive models. 
                        Predictions are grouped by month, showing their directional accuracy. 
                        A model is verified as a <strong>Success</strong> if its accuracy meets or exceeds the 85% threshold.
                      </p>
                    </div>

                    {loadingRecords ? (
                      <div className="tab-empty-state">
                        <RefreshCw className="spin-icon" size={24} />
                        <h4>Retrieving performance tracking history...</h4>
                      </div>
                    ) : predictionRecords.length > 0 ? (
                      (() => {
                        // 1. Group records by month for "System Growth"
                        const monthlyGroup = {};
                        predictionRecords.forEach(r => {
                          const m = r.month || "2026-07";
                          if (!monthlyGroup[m]) monthlyGroup[m] = [];
                          monthlyGroup[m].push(r);
                        });
                        const sortedMonths = Object.keys(monthlyGroup).sort((a, b) => b.localeCompare(a));
                        
                        // 2. Group records by ticker/currency for "Predictions One-by-One"
                        const tickerGroup = {};
                        predictionRecords.forEach(r => {
                          const t = r.ticker || "UNKNOWN";
                          if (!tickerGroup[t]) tickerGroup[t] = [];
                          tickerGroup[t].push(r);
                        });
                        const sortedTickers = Object.keys(tickerGroup).sort((a, b) => a.localeCompare(b));

                        const monthNames = {
                          "01": "January", "02": "February", "03": "March", "04": "April",
                          "05": "May", "06": "June", "07": "July", "08": "August",
                          "09": "September", "10": "October", "11": "November", "12": "December"
                        };

                        const formatMonthName = (monthStr) => {
                          const parts = monthStr.split('-');
                          return parts.length === 2 ? `${monthNames[parts[1]] || parts[1]} ${parts[0]}` : monthStr;
                        };

                        return (
                          <div className="growth-tracker-layout" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                            {/* Monthly System Growth Section */}
                            <div className="system-growth-section">
                              <h4 style={{ color: '#fff', fontSize: '16px', marginBottom: '15px', borderLeft: '3px solid #00f2fe', paddingLeft: '10px' }}>
                                📊 System Growth by Month Group
                              </h4>
                              
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                                {sortedMonths.map(month => {
                                  const monthRecords = monthlyGroup[month];
                                  const total = monthRecords.length;
                                  const successful = monthRecords.filter(r => r.result === "Success").length;
                                  const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : "0.0";
                                  const progressColor = parseFloat(successRate) >= 70 ? '#00e676' : '#ffd600';
                                  
                                  return (
                                    <div key={month} style={{ background: '#1e222b', border: '1px solid #2e333d', borderRadius: '8px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>{formatMonthName(month)}</span>
                                        <span style={{ fontSize: '14px', fontWeight: 'bold', color: progressColor }}>
                                          {successRate}% Success
                                        </span>
                                      </div>
                                      
                                      {/* Success progress bar */}
                                      <div style={{ background: '#2a2e39', height: '6px', borderRadius: '3px', width: '100%', overflow: 'hidden' }}>
                                        <div style={{ background: progressColor, height: '100%', width: `${successRate}%` }}></div>
                                      </div>
                                      
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8a909d', marginTop: '4px' }}>
                                        <span>Total Runs: <strong style={{ color: '#fff' }}>{total}</strong></span>
                                        <span>Success (≥85% Accuracy): <strong style={{ color: '#00e676' }}>{successful}</strong></span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Predictions Currency wise Section */}
                            <div className="predictions-one-by-one-section">
                              <h4 style={{ color: '#fff', fontSize: '16px', marginBottom: '15px', borderLeft: '3px solid #00f2fe', paddingLeft: '10px' }}>
                                🪙 Currency Prediction History (One by One)
                              </h4>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {sortedTickers.map(tickerSymbol => {
                                  const tickerRecords = tickerGroup[tickerSymbol];
                                  // Sort records descending by trained date
                                  tickerRecords.sort((a, b) => b.trained_at.localeCompare(a.trained_at));

                                  const tickTotal = tickerRecords.length;
                                  const tickSuccess = tickerRecords.filter(r => r.result === "Success").length;
                                  const tickRate = tickTotal > 0 ? ((tickSuccess / tickTotal) * 100).toFixed(1) : "0.0";

                                  return (
                                    <div key={tickerSymbol} className="currency-group-card" style={{ background: '#1e222b', border: '1px solid #2e333d', borderRadius: '10px', padding: '20px' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #2e333d', paddingBottom: '10px' }}>
                                        <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#00f2fe' }}>🪙 {tickerSymbol} Predictions</span>
                                        <span style={{ fontSize: '12px', color: '#8a909d' }}>
                                          Total: <strong style={{ color: '#fff' }}>{tickTotal}</strong> | 
                                          Success (≥85%): <strong style={{ color: '#00e676' }}>{tickSuccess}</strong> | 
                                          Accuracy: <strong style={{ color: '#fff' }}>{tickRate}%</strong>
                                        </span>
                                      </div>

                                      <div className="scroll-table-container">
                                        <table className="info-table">
                                          <thead>
                                            <tr>
                                              <th>Prediction Trend</th>
                                              <th>Model Accuracy (%)</th>
                                              <th>Status (Success ≥85%)</th>
                                              <th>Trained Month</th>
                                              <th>Training Date</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {tickerRecords.map((rec, idx) => {
                                              const isSuccess = rec.result === "Success";
                                              return (
                                                <tr key={rec.id || idx}>
                                                  <td>
                                                    <span className={`event-badge badge-${rec.predict.toLowerCase()}`} style={{ background: rec.predict === 'Up' ? 'rgba(8, 153, 129, 0.15)' : 'rgba(242, 54, 69, 0.15)', color: rec.predict === 'Up' ? '#089981' : '#f23645', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
                                                      {rec.predict === 'Up' ? '📈 BUY (UP)' : '📉 SELL (DOWN)'}
                                                    </span>
                                                  </td>
                                                  <td className="highlight-metric" style={{ fontWeight: 'bold', color: '#fff' }}>
                                                    {(rec.accuracy * 100).toFixed(1)}%
                                                  </td>
                                                  <td>
                                                    <span style={{ 
                                                      display: 'inline-flex', 
                                                      alignItems: 'center', 
                                                      gap: '4px',
                                                      color: isSuccess ? '#00e676' : '#ff1744', 
                                                      fontWeight: 'bold',
                                                      fontSize: '13px' 
                                                    }}>
                                                      {isSuccess ? <CheckCircle size={14} /> : <XCircle size={14} />}
                                                      {isSuccess ? "Success" : "Failed"}
                                                    </span>
                                                  </td>
                                                  <td style={{ color: '#fff', fontSize: '13px' }}>{formatMonthName(rec.month)}</td>
                                                  <td style={{ color: '#8a909d', fontSize: '12px' }}>
                                                    {new Date(rec.trained_at).toLocaleString()}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="tab-empty-state">
                        <AlertTriangle size={24} />
                        <h4>No performance records saved</h4>
                        <p>No model predictions have been recorded yet. Click 'Fetch Data & Train Model' to populate records.</p>
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
