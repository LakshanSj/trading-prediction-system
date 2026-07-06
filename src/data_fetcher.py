import os
import argparse
import pandas as pd
import yfinance as yf

def fetch_data(ticker: str, start_date: str, end_date: str, output_dir: str = "data", interval: str = "1d") -> str:
    """
    Fetches historical OHLCV data for a given ticker from yfinance
    and saves it to a CSV file in the specified directory.
    """
    from datetime import datetime, timedelta
    
    # Standardize interval strings
    interval_map = {
        "5min": "5m",
        "30min": "30m",
        "1w": "1wk",
        "1wk": "1wk",
        "5m": "5m",
        "30m": "30m",
        "1h": "1h",
        "3h": "3h",
        "12h": "12h",
        "1d": "1d",
        "3d": "3d"
    }
    interval = interval_map.get(interval.lower(), "1d")
    
    # Calculate limits for intraday data
    now = datetime.now()
    if interval in ["5m", "30m"]:
        max_start = now - timedelta(days=58)
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        if start_dt < max_start:
            start_date = max_start.strftime("%Y-%m-%d")
            print(f"Adjusted start_date to {start_date} due to 60-day limit for {interval} interval.")
    elif interval in ["1h", "3h", "12h"]:
        max_start = now - timedelta(days=728)
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        if start_dt < max_start:
            start_date = max_start.strftime("%Y-%m-%d")
            print(f"Adjusted start_date to {start_date} due to 730-day limit for hourly interval.")
            
    print(f"Fetching data for ticker '{ticker}' ({interval}) from {start_date} to {end_date}...")
    
    # Verify directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Resolve yfinance interval and resampling rules
    yf_interval = interval
    resample_rule = None
    if interval == "3h":
        yf_interval = "1h"
        resample_rule = "3h"
    elif interval == "12h":
        yf_interval = "1h"
        resample_rule = "12h"
    elif interval == "3d":
        yf_interval = "1d"
        resample_rule = "3D"
    elif interval == "1wk":
        yf_interval = "1wk"
        
    # Fetch data
    try:
        df = yf.download(ticker, start=start_date, end=end_date, interval=yf_interval, progress=False)
    except Exception as e:
        raise ValueError(f"Failed to download data for ticker '{ticker}' from yfinance. Error: {e}")
        
    if df.empty:
        raise ValueError(f"No data returned for ticker '{ticker}' within the date range {start_date} to {end_date}.")
    
    # Flatten MultiIndex columns if any
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
        
    # Reset index so 'Date' is a column (handles 'Datetime' or 'index' from yfinance)
    df = df.reset_index()
    if 'Datetime' in df.columns:
        df = df.rename(columns={'Datetime': 'Date'})
    elif 'index' in df.columns:
        df = df.rename(columns={'index': 'Date'})
        
    # Verify the structure is correct
    required_cols = {'Date', 'Open', 'High', 'Low', 'Close', 'Volume'}
    missing_cols = required_cols - set(df.columns)
    if missing_cols:
        raise ValueError(f"Fetched data is missing required columns: {missing_cols}")
        
    # Apply resampling for custom intervals (3h and 12h)
    if resample_rule:
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.set_index('Date')
        resampled = df.resample(resample_rule).agg({
            'Open': 'first',
            'High': 'max',
            'Low': 'min',
            'Close': 'last',
            'Volume': 'sum'
        }).dropna()
        df = resampled.reset_index()
        
    # Standardize column naming and sort by date
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    output_path = os.path.join(output_dir, f"raw_{ticker.lower()}_{interval.lower()}.csv")
    df.to_csv(output_path, index=False)
    print(f"Successfully saved {len(df)} rows of raw data to '{output_path}'.")
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch historical stock data from yfinance.")
    parser.add_argument("--ticker", type=str, required=True, help="Stock ticker symbol (e.g., AAPL)")
    parser.add_argument("--start", type=str, required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--interval", type=str, default="1d", help="Data interval (5m, 30m, 1h, 3h, 12h, 1d, 1wk)")
    parser.add_argument("--output_dir", type=str, default="data", help="Directory to save the raw CSV data")
    
    args = parser.parse_args()
    
    try:
        fetch_data(args.ticker, args.start, args.end, args.output_dir, args.interval)
    except Exception as e:
        print(f"Error fetching data: {e}")
        exit(1)
