import os
import argparse
import pandas as pd
import numpy as np

def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Computes the Relative Strength Index (RSI) using Wilder's EMA smoothing method."""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    
    # Wilder's smoothing equivalent: ewm with com = period - 1
    avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=period - 1, adjust=False).mean()
    
    rs = avg_gain / (avg_loss + 1e-10)
    rsi = 100 - (100 / (1 + rs))
    return rsi

def compute_macd(series: pd.Series, fast_period: int = 12, slow_period: int = 26, signal_period: int = 9):
    """Computes MACD, Signal Line, and Histogram."""
    ema_fast = series.ewm(span=fast_period, adjust=False).mean()
    ema_slow = series.ewm(span=slow_period, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
    macd_hist = macd_line - signal_line
    return macd_line, signal_line, macd_hist

def compute_stochastic(df: pd.DataFrame, period: int = 14, smooth_k: int = 3) -> tuple:
    """Computes Stochastic Oscillator %K and %D."""
    low_min = df['Low'].rolling(window=period).min()
    high_max = df['High'].rolling(window=period).max()
    stoch_k = (df['Close'] - low_min) / (high_max - low_min + 1e-10) * 100
    stoch_d = stoch_k.rolling(window=smooth_k).mean()
    return stoch_k, stoch_d

def compute_cci(df: pd.DataFrame, period: int = 20) -> pd.Series:
    """Computes the Commodity Channel Index (CCI)."""
    tp = (df['High'] + df['Low'] + df['Close']) / 3
    sma_tp = tp.rolling(window=period).mean()
    mad = tp.rolling(window=period).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
    cci = (tp - sma_tp) / (0.015 * mad + 1e-10)
    return cci

def compute_bollinger_bands(series: pd.Series, period: int = 20, num_std: int = 2) -> tuple:
    """Computes Bollinger Bands: Upper, Lower, Bandwidth, and %B."""
    mid = series.rolling(window=period).mean()
    std = series.rolling(window=period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    bandwidth = (upper - lower) / (mid + 1e-10)
    percent_b = (series - lower) / (upper - lower + 1e-10)
    return upper, lower, bandwidth, percent_b

def detect_pivots_and_smc(df: pd.DataFrame, w: int = 5) -> pd.DataFrame:
    """
    Detects market structure (BOS, CHOCH), Liquidity Sweeps, Order Blocks (OB), and Fair Value Gaps (FVG).
    Uses a lookahead-bias-free pivot confirmation.
    """
    df = df.copy()
    n = len(df)
    
    # 1. Swing Highs & Lows (confirmed at t by looking back w bars)
    is_peak = (df['High'].shift(w) == df['High'].rolling(window=2*w+1, center=True).max())
    is_trough = (df['Low'].shift(w) == df['Low'].rolling(window=2*w+1, center=True).min())
    
    df['Last_Swing_High'] = df['High'].shift(w).where(is_peak).ffill()
    df['Last_Swing_Low'] = df['Low'].shift(w).where(is_trough).ffill()
    
    # Fill initial values to prevent NaNs
    df['Last_Swing_High'] = df['Last_Swing_High'].ffill().bfill()
    df['Last_Swing_Low'] = df['Last_Swing_Low'].ffill().bfill()
    
    # 2. Break of Structure (BOS) & Change of Character (CHOCH)
    bos = np.zeros(n)
    choch = np.zeros(n)
    sma_50 = df['Close'].rolling(window=50).mean().ffill().bfill()
    
    # Tracks active Order Blocks (Supply/Demand Zones)
    bull_ob_high = np.zeros(n)
    bull_ob_low = np.zeros(n)
    bear_ob_high = np.zeros(n)
    bear_ob_low = np.zeros(n)
    
    last_bull_ob_high = 0.0
    last_bull_ob_low = 0.0
    last_bear_ob_high = 0.0
    last_bear_ob_low = 0.0
    
    # Convert series/columns to NumPy arrays for fast direct index access
    close = df['Close'].values
    open_val = df['Open'].values
    high = df['High'].values
    low = df['Low'].values
    sw_high_arr = df['Last_Swing_High'].values
    sw_low_arr = df['Last_Swing_Low'].values
    sma_50_arr = sma_50.values
    
    for i in range(1, n):
        close_curr = close[i]
        close_prev = close[i-1]
        sw_high = sw_high_arr[i]
        sw_low = sw_low_arr[i]
        trend_bull = close_curr > sma_50_arr[i]
        
        # Bullish Breakout (breaking above previous swing high)
        if close_curr > sw_high and close_prev <= sw_high:
            if trend_bull:
                bos[i] = 1
            else:
                choch[i] = 1
            # Bullish Order Block: last down candle (Close < Open) in past 5 bars
            ob_idx = i
            for k in range(max(0, i-5), i):
                if close[k] < open_val[k]:
                    ob_idx = k
            last_bull_ob_high = high[ob_idx]
            last_bull_ob_low = low[ob_idx]
            
        # Bearish Breakout (breaking below previous swing low)
        elif close_curr < sw_low and close_prev >= sw_low:
            if not trend_bull:
                bos[i] = -1
            else:
                choch[i] = -1
            # Bearish Order Block: last up candle (Close > Open) in past 5 bars
            ob_idx = i
            for k in range(max(0, i-5), i):
                if close[k] > open_val[k]:
                    ob_idx = k
            last_bear_ob_high = high[ob_idx]
            last_bear_ob_low = low[ob_idx]
            
        bull_ob_high[i] = last_bull_ob_high
        bull_ob_low[i] = last_bull_ob_low
        bear_ob_high[i] = last_bear_ob_high
        bear_ob_low[i] = last_bear_ob_low
        
    df['BOS'] = bos
    df['CHOCH'] = choch
    df['Bullish_OB_High'] = bull_ob_high
    df['Bullish_OB_Low'] = bull_ob_low
    df['Bearish_OB_High'] = bear_ob_high
    df['Bearish_OB_Low'] = bear_ob_low
    
    # 3. Liquidity Sweeps
    df['Sweep_High'] = ((df['High'] > df['Last_Swing_High']) & (df['Close'] <= df['Last_Swing_High'])).astype(int)
    df['Sweep_Low'] = ((df['Low'] < df['Last_Swing_Low']) & (df['Close'] >= df['Last_Swing_Low'])).astype(int)
    
    # 4. Fair Value Gaps (FVG)
    df['FVG_Bullish'] = (df['Low'] > df['High'].shift(2)).astype(int)
    df['FVG_Bullish_Size'] = (df['Low'] - df['High'].shift(2)).clip(lower=0)
    df['FVG_Bearish'] = (df['High'] < df['Low'].shift(2)).astype(int)
    df['FVG_Bearish_Size'] = (df['Low'].shift(2) - df['High']).clip(lower=0)
    
    return df

def compute_elliott_waves(df: pd.DataFrame, w: int = 5) -> pd.Series:
    """
    Detects the current wave of a 5-wave impulse (1-5) and 3-wave correction (A-C)
    in a strictly lookahead-bias-free manner.
    """
    n = len(df)
    elliott_wave = np.zeros(n)
    
    is_peak = (df['High'].shift(w) == df['High'].rolling(window=2*w+1, center=True).max())
    is_trough = (df['Low'].shift(w) == df['Low'].rolling(window=2*w+1, center=True).min())
    
    peak_indices = np.where(is_peak)[0]
    trough_indices = np.where(is_trough)[0]
    
    high_vals = df['High'].values
    low_vals = df['Low'].values
    
    all_pivots = []
    for idx in peak_indices:
        all_pivots.append((idx - w, 'High', float(high_vals[idx - w]), idx))
    for idx in trough_indices:
        all_pivots.append((idx - w, 'Low', float(low_vals[idx - w]), idx))
        
    all_pivots = sorted(all_pivots, key=lambda x: x[0])
    
    confirmed_pivots_by_row = [[] for _ in range(n)]
    for p in all_pivots:
        conf_idx = p[3]
        if conf_idx < n:
            confirmed_pivots_by_row[conf_idx].append(p)
            
    alternating = []
    for i in range(n):
        new_pivots = confirmed_pivots_by_row[i]
        for p in new_pivots:
            if not alternating:
                alternating.append(p)
            else:
                prev = alternating[-1]
                if prev[1] == p[1]:
                    if p[1] == 'High':
                        if p[2] > prev[2]:
                            alternating[-1] = p
                    else:
                        if p[2] < prev[2]:
                            alternating[-1] = p
                else:
                    alternating.append(p)
                    
        # Check rules on the last 6 pivots to determine wave phase
        if len(alternating) >= 6:
            p0, p1, p2, p3, p4, p5 = alternating[-6:]
            # Bullish Impulse (Low -> High -> Low -> High -> Low -> High)
            if p0[1] == 'Low' and p1[1] == 'High' and p2[1] == 'Low' and p3[1] == 'High' and p4[1] == 'Low' and p5[1] == 'High':
                rule1 = p2[2] >= p0[2]  # Wave 2 low doesn't break Wave 1 start
                rule2 = p3[2] > p1[2]   # Wave 3 breaks Wave 1 high
                rule3 = p4[2] > p1[2]   # Wave 4 low doesn't overlap Wave 1 high
                
                l1 = p1[2] - p0[2]
                l3 = p3[2] - p2[2]
                l5 = p5[2] - p4[2]
                rule4 = l3 >= min(l1, l5)  # Wave 3 is not shortest
                
                if rule1 and rule2 and rule3 and rule4:
                    curr_idx = i
                    if curr_idx > p5[0]:
                        # Check for Wave A, B, C corrections
                        if len(alternating) >= 8:
                            p6, p7 = alternating[-2:]
                            if p6[1] == 'Low' and p7[1] == 'High':
                                elliott_wave[i] = -3 # Wave C
                            else:
                                elliott_wave[i] = -2 # Wave B
                        elif len(alternating) >= 7:
                            p6 = alternating[-1]
                            if p6[1] == 'Low':
                                elliott_wave[i] = -2
                            else:
                                elliott_wave[i] = -1
                        else:
                            elliott_wave[i] = -1 # Wave A
                    elif curr_idx > p4[0]:
                        elliott_wave[i] = 5
                    elif curr_idx > p3[0]:
                        elliott_wave[i] = 4
                    elif curr_idx > p2[0]:
                        elliott_wave[i] = 3
                    elif curr_idx > p1[0]:
                        elliott_wave[i] = 2
                    else:
                        elliott_wave[i] = 1
            # Bearish Impulse
            elif p0[1] == 'High' and p1[1] == 'Low' and p2[1] == 'High' and p3[1] == 'Low' and p4[1] == 'High' and p5[1] == 'Low':
                rule1 = p2[2] <= p0[2]
                rule2 = p3[2] < p1[2]
                rule3 = p4[2] < p1[2]
                
                l1 = p0[2] - p1[2]
                l3 = p2[2] - p3[2]
                l5 = p4[2] - p5[2]
                rule4 = l3 >= min(l1, l5)
                
                if rule1 and rule2 and rule3 and rule4:
                    curr_idx = i
                    if curr_idx > p5[0]:
                        elliott_wave[i] = -1
                    elif curr_idx > p4[0]:
                        elliott_wave[i] = 5
                    elif curr_idx > p3[0]:
                        elliott_wave[i] = 4
                    elif curr_idx > p2[0]:
                        elliott_wave[i] = 3
                    elif curr_idx > p1[0]:
                        elliott_wave[i] = 2
                    else:
                        elliott_wave[i] = 1
                        
    return pd.Series(elliott_wave, index=df.index)

def compute_wma(series, period=144):
    weights = np.arange(1, period + 1)
    sum_weights = weights.sum()
    return series.rolling(period).apply(lambda w: np.dot(w, weights) / sum_weights, raw=True)

def compute_smma(series, period=5):
    return series.ewm(alpha=1 / period, adjust=False).mean()

def compute_pdf_patterns(df: pd.DataFrame, config: dict) -> pd.DataFrame:
    """
    Computes technical pattern features based on the extracted PDF strategy config.
    """
    df = df.copy()
    close = df['Close']
    open_val = df['Open']
    high = df['High']
    low = df['Low']
    body = (close - open_val).abs()
    hl_range = high - low + 1e-10
    
    # 1. Candlestick patterns
    if config.get("hammer"):
        lower_shadow = np.where(close > open_val, open_val - low, close - low)
        upper_shadow = np.where(close > open_val, high - close, high - open_val)
        df['CDL_Hammer'] = ((lower_shadow >= 1.5 * body) & (upper_shadow <= 0.3 * body)).astype(int)
        
    if config.get("inverted_hammer"):
        lower_shadow = np.where(close > open_val, open_val - low, close - low)
        upper_shadow = np.where(close > open_val, high - close, high - open_val)
        df['CDL_Inverted_Hammer'] = ((upper_shadow >= 1.5 * body) & (lower_shadow <= 0.3 * body)).astype(int)
        
    if config.get("shooting_star"):
        lower_shadow = np.where(close > open_val, open_val - low, close - low)
        upper_shadow = np.where(close > open_val, high - close, high - open_val)
        df['CDL_Shooting_Star'] = ((close < open_val) & (upper_shadow >= 1.5 * body) & (lower_shadow <= 0.3 * body)).astype(int)
        
    if config.get("doji"):
        df['CDL_Doji'] = (body <= 0.1 * hl_range).astype(int)
        
    if config.get("bullish_engulfing"):
        df['CDL_Bullish_Engulfing'] = (
            (close > open_val) & 
            (close.shift(1) < open_val.shift(1)) & 
            (close > open_val.shift(1)) & 
            (open_val < close.shift(1))
        ).astype(int)
        
    if config.get("bearish_engulfing"):
        df['CDL_Bearish_Engulfing'] = (
            (close < open_val) & 
            (close.shift(1) > open_val.shift(1)) & 
            (close < open_val.shift(1)) & 
            (open_val > close.shift(1))
        ).astype(int)
        
    if config.get("marubozu"):
        df['CDL_Marubozu'] = (body >= 0.9 * hl_range).astype(int)
        
    # 2. Chart patterns
    if config.get("double_top"):
        df['Pattern_Double_Top'] = (
            (high >= df['Last_Swing_High'] * 0.99) & 
            (high <= df['Last_Swing_High'] * 1.01) & 
            (close < open_val)
        ).astype(int)
        
    if config.get("double_bottom"):
        df['Pattern_Double_Bottom'] = (
            (low >= df['Last_Swing_Low'] * 0.99) & 
            (low <= df['Last_Swing_Low'] * 1.01) & 
            (close > open_val)
        ).astype(int)
        
    # 3. SMC concepts
    if config.get("mitigation_blocks"):
        df['SMC_Breaker_Bullish'] = (
            (close > df['Bearish_OB_High']) & 
            (close.shift(1) <= df['Bearish_OB_High']) &
            (df['Bearish_OB_High'] > 0)
        ).astype(int)
        df['SMC_Breaker_Bearish'] = (
            (close < df['Bullish_OB_Low']) & 
            (close.shift(1) >= df['Bullish_OB_Low']) &
            (df['Bullish_OB_Low'] > 0)
        ).astype(int)
        
    if config.get("premium_discount"):
        equilibrium = 0.5 * (df['Last_Swing_High'] + df['Last_Swing_Low'])
        df['SMC_Premium_Discount'] = np.where(close > equilibrium, 1, np.where(close < equilibrium, -1, 0))
        
    return df

def engineer_features(input_path: str, output_path: str = None) -> str:
    """
    Loads raw stock data, engineers features, and saves the output.
    """
    print(f"Loading raw data from '{input_path}'...")
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file '{input_path}' does not exist.")
        
    df = pd.read_csv(input_path)
    
    # Ensure Date column is parsed and sorted
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    # 1. Basic returns
    df['Return'] = df['Close'].pct_change()
    
    # 2. Return lags (returns from the last 1, 2, 3, 5, 10 periods)
    lags = [1, 2, 3, 5, 10]
    for lag in lags:
        df[f'Return_Lag_{lag}'] = df['Return'].shift(lag)
        
    # 3. Rolling Volatility (rolling standard deviation of returns)
    vol_windows = [5, 10, 20]
    for w in vol_windows:
        df[f'Vol_{w}'] = df['Return'].rolling(window=w).std()
        
    # 4. Moving Averages (Common Periods)
    df['SMA_10'] = df['Close'].rolling(window=10).mean()
    df['SMA_20'] = df['Close'].rolling(window=20).mean()
    df['SMA_50'] = df['Close'].rolling(window=50).mean()
    df['SMA_200'] = df['Close'].rolling(window=200).mean()
    
    df['EMA_12'] = df['Close'].ewm(span=12, adjust=False).mean()
    df['EMA_26'] = df['Close'].ewm(span=26, adjust=False).mean()
    df['EMA_9'] = df['Close'].ewm(span=9, adjust=False).mean()
    df['EMA_20'] = df['Close'].ewm(span=20, adjust=False).mean()
    df['EMA_50'] = df['Close'].ewm(span=50, adjust=False).mean()
    df['EMA_200'] = df['Close'].ewm(span=200, adjust=False).mean()
    
    # Custom Overlay Moving Averages
    df['WMA_144'] = compute_wma(df['Close'], 144)
    df['SMMA_5'] = compute_smma(df['Close'], 5)
    
    # 5. Crossovers & Spread Features
    # Golden / Death Cross
    df['Golden_Cross'] = ((df['SMA_50'] > df['SMA_200']) & (df['SMA_50'].shift(1) <= df['SMA_200'].shift(1))).astype(int)
    df['Death_Cross'] = ((df['SMA_50'] < df['SMA_200']) & (df['SMA_50'].shift(1) >= df['SMA_200'].shift(1))).astype(int)
    
    # Distances
    df['Dist_SMA_50'] = (df['Close'] - df['SMA_50']) / (df['SMA_50'] + 1e-10)
    df['Dist_SMA_200'] = (df['Close'] - df['SMA_200']) / (df['SMA_200'] + 1e-10)
    
    # Stack Spread
    df['MA_Stack_Spread'] = df[['SMA_20', 'SMA_50', 'SMA_200']].std(axis=1) / (df['Close'] + 1e-10)
    
    # Stack Order
    df['MA_Stack_Order'] = 0
    bullish_order = (df['SMA_10'] > df['SMA_20']) & (df['SMA_20'] > df['SMA_50']) & (df['SMA_50'] > df['SMA_200'])
    bearish_order = (df['SMA_10'] < df['SMA_20']) & (df['SMA_20'] < df['SMA_50']) & (df['SMA_50'] < df['SMA_200'])
    df.loc[bullish_order, 'MA_Stack_Order'] = 1
    df.loc[bearish_order, 'MA_Stack_Order'] = -1
    
    # Dynamic Support Bounce & Resistance Rejection
    # Within 1% threshold
    df['Support_Bounce_50'] = ((df['Low'] <= df['SMA_50'] * 1.01) & (df['Low'] >= df['SMA_50'] * 0.99) & (df['Close'] > df['Open']) & (df['Close'] > df['SMA_50'])).astype(int)
    df['Support_Bounce_200'] = ((df['Low'] <= df['SMA_200'] * 1.01) & (df['Low'] >= df['SMA_200'] * 0.99) & (df['Close'] > df['Open']) & (df['Close'] > df['SMA_200'])).astype(int)
    
    df['Resistance_Rejection_50'] = ((df['High'] >= df['SMA_50'] * 0.99) & (df['High'] <= df['SMA_50'] * 1.01) & (df['Close'] < df['Open']) & (df['Close'] < df['SMA_50'])).astype(int)
    df['Resistance_Rejection_200'] = ((df['High'] >= df['SMA_200'] * 0.99) & (df['High'] <= df['SMA_200'] * 1.01) & (df['Close'] < df['Open']) & (df['Close'] < df['SMA_200'])).astype(int)
    
    # 5.5 Fibonacci Retracement Levels (Rolling 20 and 50 period windows)
    for w in [20, 50]:
        high_roll = df['High'].rolling(window=w).max()
        low_roll = df['Low'].rolling(window=w).min()
        fib_range = high_roll - low_roll + 1e-10
        
        df[f'Fib_236_{w}'] = high_roll - 0.236 * fib_range
        df[f'Fib_382_{w}'] = high_roll - 0.382 * fib_range
        df[f'Fib_500_{w}'] = high_roll - 0.500 * fib_range
        df[f'Fib_618_{w}'] = high_roll - 0.618 * fib_range
        df[f'Fib_786_{w}'] = high_roll - 0.786 * fib_range
        
        # Distance to levels
        df[f'Dist_Fib_236_{w}'] = (df['Close'] - df[f'Fib_236_{w}']) / fib_range
        df[f'Dist_Fib_382_{w}'] = (df['Close'] - df[f'Fib_382_{w}']) / fib_range
        df[f'Dist_Fib_500_{w}'] = (df['Close'] - df[f'Fib_500_{w}']) / fib_range
        df[f'Dist_Fib_618_{w}'] = (df['Close'] - df[f'Fib_618_{w}']) / fib_range
        df[f'Dist_Fib_786_{w}'] = (df['Close'] - df[f'Fib_786_{w}']) / fib_range

    # 6. Technical Indicators (RSI, MACD, Stochastic, CCI, Bollinger Bands)
    df['RSI_14'] = compute_rsi(df['Close'], period=14)
    df['RSI_MA'] = df['RSI_14'].rolling(window=14).mean()
    
    macd_line, signal_line, macd_hist = compute_macd(df['Close'])
    df['MACD'] = macd_line
    df['MACD_Signal'] = signal_line
    df['MACD_Hist'] = macd_hist
    
    stoch_k, stoch_d = compute_stochastic(df)
    df['Stoch_K'] = stoch_k
    df['Stoch_D'] = stoch_d
    
    df['CCI_20'] = compute_cci(df)
    
    bb_upper, bb_lower, bb_bandwidth, bb_percent = compute_bollinger_bands(df['Close'])
    df['BB_Upper'] = bb_upper
    df['BB_Lower'] = bb_lower
    df['BB_Bandwidth'] = bb_bandwidth
    df['BB_Percent'] = bb_percent
    
    # 7. SMC Features (BOS, CHOCH, Order Blocks, Liquidity Sweeps, FVGs)
    df = detect_pivots_and_smc(df, w=5)
    
    # 8. Elliott Wave Count
    df['Elliott_Wave'] = compute_elliott_waves(df, w=5)
    
    # 9. PDF Strategy Guide Features
    try:
        from pdf_feature_extractor import get_pdf_features_config
        pdf_config = get_pdf_features_config()
    except Exception as e:
        print(f"Error loading PDF config: {e}. Enabling all features as fallback.")
        pdf_config = {
            "hammer": True, "inverted_hammer": True, "shooting_star": True, "doji": True,
            "bullish_engulfing": True, "bearish_engulfing": True, "marubozu": True,
            "double_top": True, "double_bottom": True, "channels": True,
            "bos_choch": True, "order_blocks": True, "mitigation_blocks": True,
            "premium_discount": True, "fvg": True, "liquidity_sweeps": True
        }
    df = compute_pdf_patterns(df, pdf_config)
    
    # 10. Market Regime Detection
    try:
        from regime_detector import detect_market_regimes
        df = detect_market_regimes(df)
        print(f"Market regimes detected successfully. Value counts:\n{df['Regime_Name'].value_counts()}")
    except Exception as e:
        print(f"Error running market regime detection: {e}. Defaulting all to Sideways.")
        df['Regime_Label'] = 2
        df['Regime_Name'] = 'Sideways'
    
    # Drop rows with NaNs resulting from shifts and rolling windows
    # Keep historical rows where possible, but MAs like SMA_200 will have NaNs for the first 200 rows.
    # Therefore, dropna is applied, ensuring enough data is left.
    initial_len = len(df)
    df = df.dropna().reset_index(drop=True)
    print(f"Dropped {initial_len - len(df)} rows due to NaNs from technical indicators/lags. Rows remaining: {len(df)}")
    
    if output_path is None:
        # Generate default name
        dir_name, file_name = os.path.split(input_path)
        new_file_name = file_name.replace("raw_", "features_")
        output_path = os.path.join(dir_name, new_file_name)
        
    df.to_csv(output_path, index=False)
    print(f"Successfully saved feature-engineered data to '{output_path}'. Total rows: {len(df)}")
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Engineer features for stock prediction.")
    parser.add_argument("--input", type=str, required=True, help="Path to raw CSV file")
    parser.add_argument("--output", type=str, default=None, help="Path to save output features CSV file")
    
    args = parser.parse_args()
    
    try:
        engineer_features(args.input, args.output)
    except Exception as e:
        print(f"Error during feature engineering: {e}")
        exit(1)
