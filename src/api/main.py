import os
import sys
import pickle
import joblib
import pandas as pd
import numpy as np
import torch
import lightgbm as lgb
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Resolve project root (two levels up from src/api/)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Add src folder to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Import from core components
from data_fetcher import fetch_data
from feature_engineer import engineer_features
from train_model import train_pipeline, ResidualLSTM
from walk_forward import run_wfv
from monitor import run_monitoring

app = FastAPI(title="AI Stock Trend Prediction API", version="1.0.0")

# Enable CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In development, allow Vite's dev server port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared memory/state to track active training runs
training_status = {}

class TrainRequest(BaseModel):
    ticker: str
    start_date: str = "2015-01-01"
    end_date: str = None
    epochs: int = 15

class WfvRequest(BaseModel):
    ticker: str
    train_size: int = 750
    test_size: int = 250
    step_size: int = 250
    epochs: int = 5

def models_exist(ticker: str) -> bool:
    t = ticker.lower()
    return (
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/arima_{t}.pkl")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/lstm_{t}.pth")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/lgb_{t}.txt")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/scaler_{t}.pkl")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/meta_{t}.pkl"))
    )

def run_train_task(ticker: str, start_date: str, end_date: str, epochs: int):
    ticker_upper = ticker.upper()
    # Change to project root so relative paths in train_pipeline work correctly
    orig_cwd = os.getcwd()
    os.chdir(PROJECT_ROOT)
    try:
        training_status[ticker_upper] = {"status": "running", "message": "Fetching data from yfinance..."}
        raw_path = fetch_data(ticker_upper, start_date, end_date)
        
        training_status[ticker_upper] = {"status": "running", "message": "Engineering technical features..."}
        features_path = engineer_features(raw_path)
        
        training_status[ticker_upper] = {"status": "running", "message": "Training hybrid models (ARIMA-LSTM & LightGBM)..."}
        meta_info = train_pipeline(features_path, ticker_upper, epochs=epochs)
        
        training_status[ticker_upper] = {
            "status": "trained",
            "message": f"Successfully trained model for {ticker_upper}!",
            "meta": meta_info
        }
    except Exception as e:
        training_status[ticker_upper] = {"status": "failed", "message": str(e)}
    finally:
        os.chdir(orig_cwd)

@app.get("/")
def read_root():
    return {"status": "healthy", "service": "Trading Prediction Backend API"}

@app.get("/api/ticker-status")
def get_ticker_status(ticker: str):
    ticker_upper = ticker.upper()
    
    # Check if there is an active training run
    if ticker_upper in training_status:
        state = training_status[ticker_upper]
        if state["status"] == "running":
            return {"status": "training", "message": state["message"]}
        elif state["status"] == "failed":
            return {"status": "failed", "message": state["message"]}
        elif state["status"] == "trained":
            # Return cached meta from training_status if available
            meta_info = state.get("meta", {})
            return {
                "status": "trained",
                "meta": {
                    "ticker": meta_info.get("ticker"),
                    "trained_at": meta_info.get("trained_at"),
                    "accuracy": meta_info.get("accuracy"),
                    "train_size": meta_info.get("train_size"),
                    "test_size": meta_info.get("test_size"),
                    "epochs": meta_info.get("epochs")
                }
            }
            
    if not models_exist(ticker_upper):
        return {"status": "untrained", "message": "No model found for this ticker."}
        
    try:
        meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{ticker_upper.lower()}.pkl")
        with open(meta_path, 'rb') as f:
            meta_info = pickle.load(f)
        return {
            "status": "trained",
            "meta": {
                "ticker": meta_info.get("ticker"),
                "trained_at": meta_info.get("trained_at"),
                "accuracy": meta_info.get("accuracy"),
                "train_size": meta_info.get("train_size"),
                "test_size": meta_info.get("test_size"),
                "epochs": meta_info.get("epochs")
            }
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to load model metadata: {e}"}

@app.post("/api/train")
def train_model(req: TrainRequest, background_tasks: BackgroundTasks):
    ticker_upper = req.ticker.upper()
    end = req.end_date or datetime.today().strftime("%Y-%m-%d")
    
    if ticker_upper in training_status and training_status[ticker_upper]["status"] == "running":
        return {"success": False, "message": "Training is already in progress for this ticker."}
        
    background_tasks.add_task(run_train_task, ticker_upper, req.start_date, end, req.epochs)
    training_status[ticker_upper] = {"status": "running", "message": "In queue..."}
    return {"success": True, "message": f"Started background training pipeline for {ticker_upper}."}

@app.get("/api/predictions")
def get_predictions(ticker: str):
    ticker_upper = ticker.upper()
    if not models_exist(ticker_upper):
        raise HTTPException(status_code=400, detail=f"Model for {ticker_upper} is not trained yet.")
        
    try:
        # Load features, models, scaler, meta (all paths resolved from project root)
        arima_path = os.path.join(PROJECT_ROOT, f"models/arima_{ticker_upper.lower()}.pkl")
        lstm_path = os.path.join(PROJECT_ROOT, f"models/lstm_{ticker_upper.lower()}.pth")
        scaler_path = os.path.join(PROJECT_ROOT, f"models/scaler_{ticker_upper.lower()}.pkl")
        meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{ticker_upper.lower()}.pkl")
        
        with open(arima_path, 'rb') as f:
            arima_result = pickle.load(f)
            
        lstm_model = ResidualLSTM(input_size=1, hidden_size=64, num_layers=2, output_size=1)
        lstm_model.load_state_dict(torch.load(lstm_path, weights_only=True))
        lstm_model.eval()
        
        scaler = joblib.load(scaler_path)
        
        with open(meta_path, 'rb') as f:
            meta_info = pickle.load(f)
            
        features_path = os.path.join(PROJECT_ROOT, f"data/features_{ticker_upper.lower()}.csv")
        if not os.path.exists(features_path):
            raise HTTPException(status_code=404, detail=f"Feature dataset not found for {ticker_upper}.")
            
        df = pd.read_csv(features_path)
        df['Date'] = pd.to_datetime(df['Date'])
        
        # Test predictions split (20% of data)
        split_idx = int(len(df) * 0.8)
        test_df = df.iloc[split_idx:].copy()
        
        # ARIMA forecast
        arima_test_preds = arima_result.forecast(steps=len(test_df))
        test_df['ARIMA_Pred'] = arima_test_preds
        test_df['Residual'] = test_df['Close'] - test_df['ARIMA_Pred']
        
        # Scale test residuals
        test_residuals = test_df['Residual'].values.reshape(-1, 1)
        scaled_test_residuals = scaler.transform(test_residuals).flatten()
        scaled_train_residuals = scaler.transform(
            (df.iloc[:split_idx]['Close'] - arima_result.fittedvalues).values.reshape(-1, 1)
        ).flatten()
        
        # LSTM input prep
        seq_len = meta_info['seq_length']
        full_residuals = np.concatenate([scaled_train_residuals[-seq_len:], scaled_test_residuals])
        
        X_lstm = []
        for i in range(len(full_residuals) - seq_len):
            X_lstm.append(full_residuals[i:(i + seq_len)])
        X_lstm = np.array(X_lstm)
        
        with torch.no_grad():
            X_tensor = torch.tensor(X_lstm, dtype=torch.float32).unsqueeze(-1)
            lstm_scaled_preds = lstm_model(X_tensor).numpy().flatten()
            
        lstm_preds = scaler.inverse_transform(lstm_scaled_preds.reshape(-1, 1)).flatten()
        test_df['LSTM_Pred'] = lstm_preds
        test_df['Hybrid_Pred'] = test_df['ARIMA_Pred'] + test_df['LSTM_Pred']
        
        # Make one-step out prediction (tomorrow)
        last_close = float(df.iloc[-1]['Close'])
        arima_next_pred = arima_result.forecast(steps=1)[0]
        recent_res = (df['Close'].values - arima_result.predict(start=0, end=len(df)-1))[-seq_len:]
        scaled_recent_res = scaler.transform(recent_res.reshape(-1, 1)).flatten()
        X_lstm_next = torch.tensor(scaled_recent_res.reshape((1, seq_len, 1)), dtype=torch.float32)
        
        with torch.no_grad():
            lstm_next_scaled = lstm_model(X_lstm_next).item()
        lstm_next_pred = scaler.inverse_transform([[lstm_next_scaled]])[0][0]
        predicted_close_next = arima_next_pred + lstm_next_pred
        predicted_direction_next = "Up" if predicted_close_next > last_close else "Down"
        
        # Format history and out-of-sample data for charts (last 100 days train + all test)
        train_df_subset = df.iloc[max(0, split_idx - 100):split_idx].copy()
        
        history = []
        for _, row in train_df_subset.iterrows():
            history.append({
                "date": row['Date'].strftime('%Y-%m-%d'),
                "close": float(row['Close']),
                "type": "train"
            })
            
        predictions = []
        for idx, row in test_df.iterrows():
            predictions.append({
                "date": row['Date'].strftime('%Y-%m-%d'),
                "actual": float(row['Close']),
                "arima": float(row['ARIMA_Pred']),
                "hybrid": float(row['Hybrid_Pred']),
                "type": "test"
            })
            
        # Overall directional accuracy of hybrid model
        test_df['Actual_Dir'] = (test_df['Close'].diff() > 0).astype(int)
        test_df['Pred_Dir'] = (test_df['Hybrid_Pred'].diff() > 0).astype(int)
        correct_dir = int((test_df['Actual_Dir'].iloc[1:] == test_df['Pred_Dir'].iloc[1:]).sum())
        total_dir = len(test_df) - 1
        accuracy = correct_dir / total_dir if total_dir > 0 else 0.0
        
        return {
            "latest_close": last_close,
            "predicted_close_tomorrow": predicted_close_next,
            "predicted_direction_tomorrow": predicted_direction_next,
            "directional_accuracy": accuracy,
            "history": history,
            "predictions": predictions
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate prediction data: {e}")

@app.get("/api/explainability")
def get_explainability(ticker: str):
    ticker_upper = ticker.upper()
    if not models_exist(ticker_upper):
        raise HTTPException(status_code=400, detail=f"Model for {ticker_upper} is not trained yet.")
        
    try:
        # Load LightGBM model and features (paths resolved from project root)
        lgb_path = os.path.join(PROJECT_ROOT, f"models/lgb_{ticker_upper.lower()}.txt")
        lgb_model = lgb.Booster(model_file=lgb_path)
        
        features_path = os.path.join(PROJECT_ROOT, f"data/features_{ticker_upper.lower()}.csv")
        df = pd.read_csv(features_path)
        
        feature_cols = [
            'Return_Lag_1', 'Return_Lag_2', 'Return_Lag_3', 'Return_Lag_5', 'Return_Lag_10',
            'Vol_5', 'Vol_10', 'Vol_20', 'SMA_10', 'SMA_20', 'EMA_12', 'EMA_26', 'RSI_14',
            'MACD', 'MACD_Signal', 'MACD_Hist'
        ]
        
        # Calculate feature contributions on latest row
        latest_features = df[feature_cols].iloc[-1:]
        contrib = lgb_model.predict(latest_features, pred_contrib=True)[0]
        
        # Map values to columns
        contributions = []
        for col, val in zip(feature_cols, contrib[:-1]): # Last index of contrib is base value
            contributions.append({
                "feature": col,
                "contribution": float(val)
            })
            
        # Sort by absolute contribution strength
        contributions = sorted(contributions, key=lambda x: abs(x["contribution"]), reverse=True)
        
        # Get basic feature importance split
        importance = lgb_model.feature_importance(importance_type='gain')
        importances = []
        for col, val in zip(feature_cols, importance):
            importances.append({
                "feature": col,
                "importance": float(val)
            })
        importances = sorted(importances, key=lambda x: x["importance"], reverse=True)
            
        return {
            "contributions": contributions,
            "importances": importances,
            "base_value": float(contrib[-1])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate explainability metrics: {e}")

@app.post("/api/wfv")
def run_wfv_endpoint(req: WfvRequest):
    ticker_upper = req.ticker.upper()
    features_path = os.path.join(PROJECT_ROOT, f"data/features_{ticker_upper.lower()}.csv")
    if not os.path.exists(features_path):
        raise HTTPException(status_code=400, detail=f"Feature dataset not found for {ticker_upper}. Please train the model first.")
        
    try:
        wfv_results = run_wfv(
            features_path, 
            train_size=req.train_size, 
            test_size=req.test_size, 
            step_size=req.step_size, 
            epochs=req.epochs
        ) or []
        
        formatted_results = []
        for r in wfv_results:
            formatted_results.append({
                "fold": r["fold"],
                "accuracy": float(r["accuracy"]),
                "sharpe": float(r["sharpe"]),
                "max_dd": float(r["max_dd"]),
                "start_date": r["start_date"].strftime('%Y-%m-%d'),
                "end_date": r["end_date"].strftime('%Y-%m-%d')
            })
            
        avg_accuracy = float(np.mean([r['accuracy'] for r in wfv_results])) if wfv_results else 0
        avg_sharpe = float(np.mean([r['sharpe'] for r in wfv_results])) if wfv_results else 0
        avg_max_dd = float(np.mean([r['max_dd'] for r in wfv_results])) if wfv_results else 0
        
        return {
            "folds": formatted_results,
            "average_accuracy": avg_accuracy,
            "average_sharpe": avg_sharpe,
            "average_max_dd": avg_max_dd
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error running walk-forward validation: {e}")

@app.post("/api/monitor")
def run_monitoring_endpoint(ticker: str):
    ticker_upper = ticker.upper()
    if not models_exist(ticker_upper):
        raise HTTPException(status_code=400, detail=f"Model for {ticker_upper} is not trained yet.")
        
    try:
        # Change to project root so monitor.py can find model/data files with relative paths
        orig_cwd = os.getcwd()
        os.chdir(PROJECT_ROOT)
        try:
            run_monitoring(ticker_upper)
        finally:
            os.chdir(orig_cwd)
        
        log_path = os.path.join(PROJECT_ROOT, f"logs/monitoring_{ticker_upper.lower()}.csv")
        if not os.path.exists(log_path):
            raise HTTPException(status_code=500, detail="Monitoring update completed but failed to save output log.")
            
        df_log = pd.read_csv(log_path)
        
        # Calculate trailing accuracy
        evaluated = df_log.dropna(subset=['Correct']).copy()
        rolling_acc = 0.0
        decay_warning = False
        
        if len(evaluated) > 0:
            correct_preds = int(evaluated['Correct'].sum())
            total_preds = len(evaluated)
            rolling_acc = correct_preds / total_preds
            if total_preds >= 5 and rolling_acc < 0.50:
                decay_warning = True
                
        # Format logs for frontend
        logs = []
        for _, row in df_log.iterrows():
            logs.append({
                "date": str(row['Date']),
                "predicted_close": float(row['Predicted_Close']) if not pd.isna(row['Predicted_Close']) else None,
                "predicted_direction": str(row['Predicted_Direction']) if not pd.isna(row['Predicted_Direction']) else None,
                "actual_close": float(row['Actual_Close']) if not pd.isna(row['Actual_Close']) else None,
                "actual_direction": str(row['Actual_Direction']) if not pd.isna(row['Actual_Direction']) else None,
                "correct": bool(row['Correct']) if not pd.isna(row['Correct']) else None
            })
            
        return {
            "rolling_accuracy": rolling_acc,
            "total_evaluated_days": len(evaluated),
            "decay_warning": decay_warning,
            "history": logs
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error running monitoring: {e}")
