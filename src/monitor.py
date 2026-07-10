import os
import argparse
import pickle
import pandas as pd
import numpy as np
import yfinance as yf
import lightgbm as lgb
from datetime import datetime, timedelta

# Import feature engineer
from feature_engineer import engineer_features

def load_models(ticker: str, interval: str = "1d"):
    """Loads all saved LightGBM models and meta parameters for a ticker."""
    t = ticker.lower()
    i = interval.lower()
    lgb_reg_path = f"models/lgb_reg_{t}_{i}.txt"
    lgb_clf_path = f"models/lgb_clf_{t}_{i}.txt"
    meta_path = f"models/meta_{t}_{i}.pkl"
    
    if not (os.path.exists(lgb_reg_path) and os.path.exists(lgb_clf_path) and os.path.exists(meta_path)):
        raise FileNotFoundError(f"Trained models not found for ticker '{ticker}' at interval '{interval}'. Please train models first.")
        
    lgb_reg = lgb.Booster(model_file=lgb_reg_path)
    lgb_clf = lgb.Booster(model_file=lgb_clf_path)
    
    with open(meta_path, 'rb') as f:
        meta_info = pickle.load(f)
        
    return lgb_reg, lgb_clf, meta_info

def run_monitoring(ticker: str, interval: str = "1d", alert_threshold=0.50, min_days=5):
    """
    Main monitoring pipeline:
    1. Update previous days' predictions with actual outcomes.
    2. Assess model decay and print retrain alert if accuracy drops.
    3. Generate and log prediction for the next trading session.
    """
    ticker = ticker.lower()
    interval_lower = interval.lower()
    log_dir = "logs"
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"monitoring_{ticker}_{interval_lower}.csv")
    
    # Load models
    try:
        lgb_reg, lgb_clf, meta_info = load_models(ticker, interval)
    except Exception as e:
        print(f"Error loading models: {e}")
        return
        
    # Fetch recent historical data to run predictions
    print(f"Fetching recent data for {ticker.upper()} ({interval})...")
    today = datetime.now()
    
    # Standardize interval strings for download limits
    interval_map = {
        "1w": "1wk", "1wk": "1wk",
        "1d": "1d",
        "4h": "4h",
        "1h": "1h"
    }
    std_interval = interval_map.get(interval_lower, "1d")
    
    # Configure start_date limits to ensure at least 200+ bars exist after feature engineering drops NaNs
    if std_interval == "1h":
        start_date = (today - timedelta(days=45)).strftime("%Y-%m-%d")
        yf_interval = "1h"
    elif std_interval == "4h":
        start_date = (today - timedelta(days=180)).strftime("%Y-%m-%d")
        yf_interval = "1h"
    elif std_interval == "1wk":
        start_date = (today - timedelta(days=365 * 6)).strftime("%Y-%m-%d")
        yf_interval = "1wk"
    else:
        # Default is 1d (need at least 200 trading days; 450 calendar days is ~310 trading days)
        start_date = (today - timedelta(days=450)).strftime("%Y-%m-%d")
        yf_interval = "1d"
        
    end_date = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    
    df_raw = yf.download(ticker.upper(), start=start_date, end=end_date, interval=yf_interval, progress=False)
    if df_raw.empty:
        print("Failed to fetch recent data from yfinance.")
        return
        
    if isinstance(df_raw.columns, pd.MultiIndex):
        df_raw.columns = df_raw.columns.get_level_values(0)
    df_raw = df_raw.reset_index()
    if 'Datetime' in df_raw.columns:
        df_raw = df_raw.rename(columns={'Datetime': 'Date'})
    elif 'index' in df_raw.columns:
        df_raw = df_raw.rename(columns={'index': 'Date'})
        
    df_raw['Date'] = pd.to_datetime(df_raw['Date'])
    df_raw = df_raw.sort_values('Date').reset_index(drop=True)
    
    # Apply resampling for custom intervals (4h)
    resample_rule = None
    if std_interval == "4h":
        resample_rule = "4h"
        
    if resample_rule:
        df_raw = df_raw.set_index('Date')
        resampled = df_raw.resample(resample_rule).agg({
            'Open': 'first',
            'High': 'max',
            'Low': 'min',
            'Close': 'last',
            'Volume': 'sum'
        }).dropna()
        df_raw = resampled.reset_index()
        
    # Save a temporary file to run feature engineering
    temp_raw_path = f"data/temp_raw_{ticker}_{interval_lower}.csv"
    df_raw.to_csv(temp_raw_path, index=False)
    
    # Engineer features
    try:
        temp_features_path = engineer_features(temp_raw_path, f"data/temp_features_{ticker}_{interval_lower}.csv")
        df_features = pd.read_csv(temp_features_path)
        df_features['Date'] = pd.to_datetime(df_features['Date'])
    except Exception as e:
        print(f"Error engineering features: {e}")
        return
    finally:
        # Clean up temp files
        if os.path.exists(temp_raw_path):
            os.remove(temp_raw_path)
            
    if os.path.exists(f"data/temp_features_{ticker}_{interval_lower}.csv"):
        os.remove(f"data/temp_features_{ticker}_{interval_lower}.csv")
        
    # Load monitoring log or create a new one
    if os.path.exists(log_path):
        monitor_df = pd.read_csv(log_path)
        monitor_df['Date'] = pd.to_datetime(monitor_df['Date'])
    else:
        monitor_df = pd.DataFrame(columns=[
            'Date', 'Predicted_Close', 'Predicted_Direction', 'Actual_Close', 'Actual_Direction', 'Correct'
        ])
        
    # --- STEP A: Update actuals for past predictions ---
    if len(monitor_df) > 0:
        print("Updating actual outcomes for previous predictions...")
        for idx, row in monitor_df.iterrows():
            if pd.isna(row['Actual_Close']):
                pred_date = pd.to_datetime(row['Date']).date()
                match = df_features[df_features['Date'].dt.date == pred_date]
                if not match.empty:
                    actual_close = float(match.iloc[0]['Close'])
                    
                    match_idx = match.index[0]
                    if match_idx > 0:
                        prev_close = float(df_features.iloc[match_idx - 1]['Close'])
                        actual_dir = "Up" if actual_close > prev_close else "Down"
                        correct = 1 if row['Predicted_Direction'] == actual_dir else 0
                        
                        monitor_df.at[idx, 'Actual_Close'] = actual_close
                        monitor_df.at[idx, 'Actual_Direction'] = actual_dir
                        monitor_df.at[idx, 'Correct'] = correct
                        print(f"Updated {pred_date.strftime('%Y-%m-%d')}: Pred={row['Predicted_Direction']}, Actual={actual_dir}, Correct={correct}")
                        
    # --- STEP B: Assess model decay ---
    completed = monitor_df.dropna(subset=['Correct'])
    if len(completed) >= min_days:
        last_n = completed.tail(10)
        accuracy = last_n['Correct'].mean()
        print(f"Current Model Accuracy: {accuracy:.2%} over the last {len(last_n)} trading days.")
        
        if accuracy < alert_threshold:
            print("\n" + "!"*40)
            print("ALERT: MODEL RETRAINING REQUIRED")
            print(f"Model accuracy has dropped to {accuracy:.2%} (Threshold: {alert_threshold:.2%})")
            print("!"*40 + "\n")
    else:
        print(f"Collecting prediction history. Currently have {len(completed)} validated days (minimum {min_days} needed).")
        
    # --- STEP C: Make prediction for the next trading day ---
    last_row = df_features.iloc[-1]
    last_date = pd.to_datetime(last_row['Date'])
    
    # Calculate next timestamp based on interval
    if std_interval in ["5m", "5min"]:
        next_date = last_date + timedelta(minutes=5)
    elif std_interval in ["30m", "30min"]:
        next_date = last_date + timedelta(minutes=30)
    elif std_interval == "1h":
        next_date = last_date + timedelta(hours=1)
    elif std_interval == "3h":
        next_date = last_date + timedelta(hours=3)
    elif std_interval == "12h":
        next_date = last_date + timedelta(hours=12)
    elif std_interval == "3d":
        next_date = last_date + timedelta(days=3)
    elif std_interval in ["1wk", "1w"]:
        next_date = last_date + timedelta(weeks=1)
    else: # Default 1d
        next_date = last_date + timedelta(days=1)
        
    # Skip weekends for daily/weekly indicators
    if std_interval in ["1d", "3d", "1wk", "1w"]:
        if next_date.weekday() == 5: # Saturday
            next_date += timedelta(days=2)
        elif next_date.weekday() == 6: # Sunday
            next_date += timedelta(days=1)
            
    is_intraday = df_features['Date'].dt.time.nunique() > 1
    next_date_str = next_date.strftime('%Y-%m-%d %H:%M') if is_intraday else next_date.strftime('%Y-%m-%d')
    
    if len(monitor_df) > 0 and (monitor_df['Date'].dt.date == next_date.date() if not is_intraday else monitor_df['Date'] == next_date).any():
        print(f"Prediction for next trading interval ({next_date_str}) already generated.")
    else:
        print(f"Generating prediction for next trading interval ({next_date_str})...")
        
        # Prepare feature vector for LightGBM models
        feature_cols = meta_info['feature_cols']
        latest_features = df_features[feature_cols].iloc[-1:]
        
        # Predict Close Price using LightGBM Regressor
        predicted_close = float(lgb_reg.predict(latest_features)[0])
        
        # Predict Direction using LightGBM Classifier
        pred_dir_prob = float(lgb_clf.predict(latest_features)[0])
        predicted_direction = "Up" if pred_dir_prob > 0.5 else "Down"
        
        # Append to monitor dataframe
        new_row = pd.DataFrame([{
            'Date': next_date,
            'Predicted_Close': predicted_close,
            'Predicted_Direction': predicted_direction,
            'Actual_Close': np.nan,
            'Actual_Direction': np.nan,
            'Correct': np.nan
        }])
        
        monitor_df = pd.concat([monitor_df, new_row], ignore_index=True)
        print(f"Generated prediction for {next_date_str}: Close={predicted_close:.2f}, Dir={predicted_direction}")
        
    # Save monitoring log
    monitor_df.to_csv(log_path, index=False)
    print(f"Monitoring log updated and saved to '{log_path}'.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Daily model decay monitoring and prediction generation.")
    parser.add_argument("--ticker", type=str, required=True, help="Stock ticker symbol")
    parser.add_argument("--interval", type=str, default="1d", help="Stock interval/timeframe")
    parser.add_argument("--threshold", type=float, default=0.50, help="Alert accuracy threshold")
    parser.add_argument("--min_days", type=int, default=5, help="Minimum days of history to check decay")
    
    args = parser.parse_args()
    
    run_monitoring(args.ticker, interval=args.interval, alert_threshold=args.threshold, min_days=args.min_days)
