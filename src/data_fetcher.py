import os
import argparse
import pandas as pd
import yfinance as yf

def fetch_data(ticker: str, start_date: str, end_date: str, output_dir: str = "data") -> str:
    """
    Fetches historical OHLCV data for a given ticker from yfinance
    and saves it to a CSV file in the specified directory.
    """
    print(f"Fetching data for ticker '{ticker}' from {start_date} to {end_date}...")
    
    # Verify directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Fetch data
    try:
        df = yf.download(ticker, start=start_date, end=end_date, progress=False)
    except Exception as e:
        raise ValueError(f"Failed to download data for ticker '{ticker}' from yfinance. Error: {e}")
        
    if df.empty:
        raise ValueError(f"No data returned for ticker '{ticker}' within the date range {start_date} to {end_date}.")
    
    # Flatten MultiIndex columns if any (newer yfinance versions sometimes return multi-level headers)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
        
    # Reset index so 'Date' is a column
    df = df.reset_index()
    
    # Verify the structure is correct
    required_cols = {'Date', 'Open', 'High', 'Low', 'Close', 'Volume'}
    missing_cols = required_cols - set(df.columns)
    if missing_cols:
        raise ValueError(f"Fetched data is missing required columns: {missing_cols}")
        
    # Standardize column naming and sort by date
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    output_path = os.path.join(output_dir, f"raw_{ticker.lower()}.csv")
    df.to_csv(output_path, index=False)
    print(f"Successfully saved {len(df)} rows of raw data to '{output_path}'.")
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch historical stock data from yfinance.")
    parser.add_argument("--ticker", type=str, required=True, help="Stock ticker symbol (e.g., AAPL)")
    parser.add_argument("--start", type=str, required=True, help="Start date (YYYY-MM-DD)")
    parser.add_argument("--end", type=str, required=True, help="End date (YYYY-MM-DD)")
    parser.add_argument("--output_dir", type=str, default="data", help="Directory to save the raw CSV data")
    
    args = parser.parse_args()
    
    try:
        fetch_data(args.ticker, args.start, args.end, args.output_dir)
    except Exception as e:
        print(f"Error fetching data: {e}")
        exit(1)
