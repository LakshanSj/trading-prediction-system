import os
import argparse
import pickle
import joblib
import pandas as pd
import numpy as np
import yfinance as yf
import torch
import torch.nn as nn
from datetime import datetime, timedelta

# Import feature engineer
from feature_engineer import engineer_features, compute_rsi, compute_macd

# Define local PyTorch LSTM model structure matching train_model
class ResidualLSTM(nn.Module):
    def __init__(self, input_size=1, hidden_size=64, num_layers=2, output_size=1):
        super(ResidualLSTM, self).__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out

def load_models(ticker: str):
    """Loads all saved models, scalers, and meta parameters for a ticker."""
    arima_path = f"models/arima_{ticker.lower()}.pkl"
    lstm_path = f"models/lstm_{ticker.lower()}.pth"
    lgb_path = f"models/lgb_{ticker.lower()}.txt"
    scaler_path = f"models/scaler_{ticker.lower()}.pkl"
    meta_path = f"models/meta_{ticker.lower()}.pkl"
    
    if not (os.path.exists(arima_path) and os.path.exists(lstm_path) and os.path.exists(scaler_path) and os.path.exists(meta_path)):
        raise FileNotFoundError(f"Trained models not found for ticker '{ticker}'. Please train models first.")
        
    with open(arima_path, 'rb') as f:
        arima_result = pickle.load(f)
        
    # Load PyTorch LSTM Model
    lstm_model = ResidualLSTM(input_size=1, hidden_size=64, num_layers=2, output_size=1)
    lstm_model.load_state_dict(torch.load(lstm_path))
    lstm_model.eval()
    
    scaler = joblib.load(scaler_path)
    
    with open(meta_path, 'rb') as f:
        meta_info = pickle.load(f)
        
    return arima_result, lstm_model, scaler, meta_info

def run_monitoring(ticker: str, alert_threshold=0.50, min_days=5):
    """
    Main monitoring pipeline:
    1. Update previous days' predictions with actual outcomes.
    2. Assess model decay and print retrain alert if accuracy drops.
    3. Generate and log prediction for the next trading session.
    """
    ticker = ticker.lower()
    log_dir = "logs"
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"monitoring_{ticker}.csv")
    
    # Load models
    try:
        arima_result, lstm_model, scaler, meta_info = load_models(ticker)
    except Exception as e:
        print(f"Error loading models: {e}")
        return
        
    # Fetch recent historical data (last 30 days) to run predictions
    print(f"Fetching recent data for {ticker.upper()}...")
    today = datetime.now()
    start_date = (today - timedelta(days=45)).strftime("%Y-%m-%d")
    end_date = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    
    df_raw = yf.download(ticker.upper(), start=start_date, end=end_date, progress=False)
    if df_raw.empty:
        print("Failed to fetch recent data from yfinance.")
        return
        
    if isinstance(df_raw.columns, pd.MultiIndex):
        df_raw.columns = df_raw.columns.get_level_values(0)
    df_raw = df_raw.reset_index()
    df_raw['Date'] = pd.to_datetime(df_raw['Date'])
    df_raw = df_raw.sort_values('Date').reset_index(drop=True)
    
    # Save a temporary file to run feature engineering
    temp_raw_path = f"data/temp_raw_{ticker}.csv"
    df_raw.to_csv(temp_raw_path, index=False)
    
    # Engineer features
    try:
        temp_features_path = engineer_features(temp_raw_path, f"data/temp_features_{ticker}.csv")
        df_features = pd.read_csv(temp_features_path)
    except Exception as e:
        print(f"Error engineering features: {e}")
        return
    finally:
        # Clean up temp files
        if os.path.exists(temp_raw_path):
            os.remove(temp_raw_path)
            
    if os.path.exists(f"data/temp_features_{ticker}.csv"):
        os.remove(f"data/temp_features_{ticker}.csv")
        
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
    
    next_date = last_date + timedelta(days=1)
    if next_date.weekday() == 5: # Saturday
        next_date += timedelta(days=2)
    elif next_date.weekday() == 6: # Sunday
        next_date += timedelta(days=1)
        
    next_date_str = next_date.strftime('%Y-%m-%d')
    
    if len(monitor_df) > 0 and (monitor_df['Date'].dt.date == next_date.date()).any():
        print(f"Prediction for next trading day ({next_date_str}) already generated.")
    else:
        print(f"Generating prediction for next trading day ({next_date_str})...")
        # 1. ARIMA forecast:
        arima_pred = arima_result.forecast(steps=1)[0]
        
        # 2. LSTM residual forecast:
        try:
            updated_arima = arima_result.apply(df_features['Close'].values)
            recent_residuals = (df_features['Close'].values - updated_arima.fittedvalues)[-meta_info['seq_length']:]
        except Exception as e:
            print(f"Warning: ARIMA apply failed: {e}. Using fallback residuals.")
            recent_residuals = (df_features['Close'].values - df_features['Close'].shift(1).fillna(method='bfill').values)[-meta_info['seq_length']:]
            
        scaled_residuals = scaler.transform(recent_residuals.reshape(-1, 1)).flatten()
        
        # Format for PyTorch LSTM
        X_lstm = torch.tensor(scaled_residuals.reshape((1, meta_info['seq_length'], 1)), dtype=torch.float32)
        
        # Predict LSTM residual
        with torch.no_grad():
            lstm_scaled_pred = lstm_model(X_lstm).item()
        lstm_pred = scaler.inverse_transform([[lstm_scaled_pred]])[0][0]
        
        # Hybrid prediction
        predicted_close = arima_pred + lstm_pred
        
        # Compare with today's Close to get predicted direction
        today_close = float(df_features.iloc[-1]['Close'])
        predicted_direction = "Up" if predicted_close > today_close else "Down"
        
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
    parser.add_argument("--threshold", type=float, default=0.50, help="Alert accuracy threshold")
    parser.add_argument("--min_days", type=int, default=5, help="Minimum days of history to check decay")
    
    args = parser.parse_args()
    
    run_monitoring(args.ticker, alert_threshold=args.threshold, min_days=args.min_days)
