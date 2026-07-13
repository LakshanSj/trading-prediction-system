import pandas as pd
import numpy as np

def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Computes the Average True Range (ATR)."""
    high = df['High']
    low = df['Low']
    close = df['Close']
    tr = pd.concat([
        (high - low),
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs()
    ], axis=1).max(axis=1)
    
    # Wilder's EMA for smoothing
    atr = tr.ewm(alpha=1/period, adjust=False).mean()
    return atr

def compute_adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Computes the Average Directional Index (ADX) to measure trend strength."""
    high = df['High']
    low = df['Low']
    close = df['Close']
    
    tr = pd.concat([
        (high - low),
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs()
    ], axis=1).max(axis=1)
    
    up_move = high.diff()
    down_move = low.diff()
    
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    
    # Wilder's smoothing
    tr_smooth = tr.ewm(alpha=1/period, adjust=False).mean()
    plus_dm_smooth = pd.Series(plus_dm, index=df.index).ewm(alpha=1/period, adjust=False).mean()
    minus_dm_smooth = pd.Series(minus_dm, index=df.index).ewm(alpha=1/period, adjust=False).mean()
    
    plus_di = 100 * (plus_dm_smooth / (tr_smooth + 1e-10))
    minus_di = 100 * (minus_dm_smooth / (tr_smooth + 1e-10))
    
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di + 1e-10)
    adx = dx.ewm(alpha=1/period, adjust=False).mean()
    return adx

def detect_market_regimes(df: pd.DataFrame) -> pd.DataFrame:
    """
    Classifies the dataset into four distinct market regimes:
      - 0: Bull (Strong uptrend, moderate volatility)
      - 1: Bear (Strong downtrend, moderate/high volatility)
      - 2: Sideways (Weak trend, low volatility)
      - 3: High Volatility (Extreme volatility / trend transitions)
    
    Uses ADX (Trend Strength), ATR Ratio (Volatility), EMA Slope (Trend Direction), and BB Width.
    """
    df = df.copy()
    
    # Check if necessary base columns exist
    for col in ['Close', 'High', 'Low', 'Volume']:
        if col not in df.columns:
            raise ValueError(f"Required column '{col}' missing for regime detection.")
            
    # 1. Compute components if not already present
    if 'ATR_14' not in df.columns:
        df['ATR_14'] = compute_atr(df, period=14)
    if 'ADX_14' not in df.columns:
        df['ADX_14'] = compute_adx(df, period=14)
        
    df['ATR_Ratio'] = df['ATR_14'] / (df['Close'] + 1e-10)
    
    # 50 EMA Slope
    if 'EMA_50' not in df.columns:
        df['EMA_50'] = df['Close'].ewm(span=50, adjust=False).mean()
    df['EMA_50_Slope'] = (df['EMA_50'] - df['EMA_50'].shift(5)) / (df['EMA_50'].shift(5) + 1e-10)
    
    # Bollinger Band Width
    if 'BB_Upper' in df.columns and 'BB_Lower' in df.columns:
        bb_mid = (df['BB_Upper'] + df['BB_Lower']) / 2 + 1e-10
        df['BB_Width'] = (df['BB_Upper'] - df['BB_Lower']) / bb_mid
    else:
        # Fallback to computing simple Bollinger Bands width
        mid = df['Close'].rolling(window=20).mean()
        std = df['Close'].rolling(window=20).std()
        upper = mid + 2 * std
        lower = mid - 2 * std
        df['BB_Width'] = (upper - lower) / (mid + 1e-10)
        
    # Standardize/clean features (fill initial NaNs)
    df['ATR_Ratio'] = df['ATR_Ratio'].ffill().bfill()
    df['ADX_14'] = df['ADX_14'].ffill().bfill()
    df['EMA_50_Slope'] = df['EMA_50_Slope'].ffill().bfill()
    df['BB_Width'] = df['BB_Width'].ffill().bfill()
    
    # Rolling averages to use as relative thresholds
    avg_atr_ratio = df['ATR_Ratio'].rolling(window=100, min_periods=1).mean()
    avg_bb_width = df['BB_Width'].rolling(window=100, min_periods=1).mean()
    
    # Pre-allocate output arrays
    n = len(df)
    regime_labels = np.zeros(n, dtype=int)
    regime_names = []
    
    atr_ratio_arr = df['ATR_Ratio'].values
    bb_width_arr = df['BB_Width'].values
    adx_arr = df['ADX_14'].values
    slope_arr = df['EMA_50_Slope'].values
    
    avg_atr_ratio_arr = avg_atr_ratio.values
    avg_bb_width_arr = avg_bb_width.values
    
    for i in range(n):
        # 1. High Volatility Check
        # Threshold: ATR ratio or Bollinger Band Width is 1.4x the rolling average
        is_high_vol = (atr_ratio_arr[i] > 1.4 * avg_atr_ratio_arr[i]) or (bb_width_arr[i] > 1.4 * avg_bb_width_arr[i])
        
        if is_high_vol:
            regime_labels[i] = 3 # High Volatility
            regime_names.append("High Volatility")
        else:
            # 2. Trend Strength Check
            # Strong trend is defined by ADX >= 20
            if adx_arr[i] >= 20:
                if slope_arr[i] > 0.0002:
                    regime_labels[i] = 0 # Bull
                    regime_names.append("Bull")
                elif slope_arr[i] < -0.0002:
                    regime_labels[i] = 1 # Bear
                    regime_names.append("Bear")
                else:
                    regime_labels[i] = 2 # Sideways
                    regime_names.append("Sideways")
            else:
                # Weak trend
                regime_labels[i] = 2 # Sideways
                regime_names.append("Sideways")
                
    df['Regime_Label'] = regime_labels
    df['Regime_Name'] = regime_names
    
    return df
