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
        
    # 4. Moving Averages
    df['SMA_10'] = df['Close'].rolling(window=10).mean()
    df['SMA_20'] = df['Close'].rolling(window=20).mean()
    df['EMA_12'] = df['Close'].ewm(span=12, adjust=False).mean()
    df['EMA_26'] = df['Close'].ewm(span=26, adjust=False).mean()
    
    # 5. RSI (14)
    df['RSI_14'] = compute_rsi(df['Close'], period=14)
    
    # 6. MACD (12, 26, 9)
    macd_line, signal_line, macd_hist = compute_macd(df['Close'])
    df['MACD'] = macd_line
    df['MACD_Signal'] = signal_line
    df['MACD_Hist'] = macd_hist
    
    # Drop rows with NaNs resulting from shifts and rolling windows
    initial_len = len(df)
    df = df.dropna().reset_index(drop=True)
    print(f"Dropped {initial_len - len(df)} rows due to NaNs from technical indicators/lags.")
    
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
