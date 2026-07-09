import os
import sys
import pickle
import joblib
import pandas as pd
import numpy as np
import torch
import lightgbm as lgb
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Resolve project root (two levels up from src/api/)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Add src/ folder to Python path (for data_fetcher, feature_engineer, etc.)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
# Add src/api/ folder to Python path (for admin.py, admin_logger.py)
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

# Import from core components
from data_fetcher import fetch_data
from feature_engineer import engineer_features
from train_model import train_pipeline, ResidualLSTM
from walk_forward import run_wfv
from monitor import run_monitoring

# Import admin logger & router
from admin_logger import write_log, EventType
from admin import router as admin_router

app = FastAPI(title="AI Stock Trend Prediction API", version="1.0.0")

# Enable CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins (credentials must be False when using wildcard)
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register admin router (prefix: /admin)
app.include_router(admin_router)

# Shared memory/state to track active training runs
training_status = {}

class TrainRequest(BaseModel):
    ticker: str
    interval: str = "1d"
    start_date: str = "2015-01-01"
    end_date: str = None
    epochs: int = 15

class WfvRequest(BaseModel):
    ticker: str
    interval: str = "1d"
    train_size: int = 750
    test_size: int = 250
    step_size: int = 250
    epochs: int = 5

def models_exist(ticker: str, interval: str = "1d") -> bool:
    t = ticker.lower()
    i = interval.lower()
    # Check new format with interval suffix
    new_format = (
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/arima_{t}_{i}.pkl")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/lstm_{t}_{i}.pth")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/lgb_{t}_{i}.txt")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/scaler_{t}_{i}.pkl")) and
        os.path.exists(os.path.join(PROJECT_ROOT, f"models/meta_{t}_{i}.pkl"))
    )
    if new_format:
        return True
    # Fallback to legacy files for daily data
    if i == "1d":
        return (
            os.path.exists(os.path.join(PROJECT_ROOT, f"models/arima_{t}.pkl")) and
            os.path.exists(os.path.join(PROJECT_ROOT, f"models/lstm_{t}.pth")) and
            os.path.exists(os.path.join(PROJECT_ROOT, f"models/lgb_{t}.txt")) and
            os.path.exists(os.path.join(PROJECT_ROOT, f"models/scaler_{t}.pkl")) and
            os.path.exists(os.path.join(PROJECT_ROOT, f"models/meta_{t}.pkl"))
        )
    return False

def run_train_task(ticker: str, start_date: str, end_date: str, epochs: int, interval: str = "1d"):
    ticker_upper = ticker.upper()
    # Change to project root so relative paths in train_pipeline work correctly
    orig_cwd = os.getcwd()
    os.chdir(PROJECT_ROOT)
    try:
        status_key = f"{ticker_upper}_{interval.upper()}"
        training_status[status_key] = {"status": "running", "message": "Fetching data from yfinance..."}
        write_log(EventType.TRAIN_START, {"ticker": ticker_upper, "interval": interval,
                                          "start_date": start_date, "end_date": end_date, "epochs": epochs})

        raw_path = fetch_data(ticker_upper, start_date, end_date, interval=interval)

        training_status[status_key] = {"status": "running", "message": "Engineering technical features..."}
        features_path = engineer_features(raw_path)

        training_status[status_key] = {"status": "running", "message": "Training hybrid models (ARIMA-LSTM & LightGBM)..."}
        meta_info = train_pipeline(features_path, ticker_upper, interval=interval, epochs=epochs)

        training_status[status_key] = {
            "status": "trained",
            "message": f"Successfully trained model for {ticker_upper}!",
            "meta": meta_info
        }
        write_log(EventType.TRAIN_COMPLETE, {"ticker": ticker_upper, "interval": interval,
                                             "accuracy": meta_info.get("accuracy"),
                                             "train_size": meta_info.get("train_size"),
                                             "test_size": meta_info.get("test_size")})
    except Exception as e:
        status_key = f"{ticker_upper}_{interval.upper()}"
        training_status[status_key] = {"status": "failed", "message": str(e)}
        write_log(EventType.TRAIN_FAILED, {"ticker": ticker_upper, "interval": interval, "error": str(e)}, success=False)
    finally:
        os.chdir(orig_cwd)

@app.get("/")
def read_root():
    return {"status": "healthy", "service": "Trading Prediction Backend API", "version": "1.0.0"}

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "Trading Prediction Backend API", "version": "1.0.0"}

@app.get("/api/ticker-status")
def get_ticker_status(ticker: str, interval: str = "1d"):
    ticker_upper = ticker.upper()
    status_key = f"{ticker_upper}_{interval.upper()}"
    
    # Check if there is an active training run
    if status_key in training_status:
        state = training_status[status_key]
        if state["status"] == "running":
            # Return "training" status to match what the frontend polls for
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
                    "interval": meta_info.get("interval", "1d"),
                    "trained_at": meta_info.get("trained_at"),
                    "accuracy": meta_info.get("accuracy"),
                    "train_size": meta_info.get("train_size"),
                    "test_size": meta_info.get("test_size"),
                    "epochs": meta_info.get("epochs")
                }
            }
            
    if not models_exist(ticker_upper, interval):
        return {"status": "untrained", "message": "No model found for this ticker."}
        
    try:
        t = ticker_upper.lower()
        i = interval.lower()
        meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{t}_{i}.pkl")
        if i == "1d" and not os.path.exists(meta_path):
            meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{t}.pkl")
            
        with open(meta_path, 'rb') as f:
            meta_info = pickle.load(f)
        return {
            "status": "trained",
            "meta": {
                "ticker": meta_info.get("ticker"),
                "interval": meta_info.get("interval", "1d"),
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
    
    status_key = f"{ticker_upper}_{req.interval.upper()}"
    if status_key in training_status and training_status[status_key]["status"] == "running":
        return {"success": False, "message": "Training is already in progress for this ticker/interval."}
        
    background_tasks.add_task(run_train_task, ticker_upper, req.start_date, end, req.epochs, req.interval)
    training_status[status_key] = {"status": "running", "message": "In queue..."}
    return {"success": True, "message": f"Started background training pipeline for {ticker_upper} ({req.interval})."}

@app.get("/api/predictions")
def get_predictions(ticker: str, interval: str = "1d"):
    ticker_upper = ticker.upper()
    if not models_exist(ticker_upper, interval):
        raise HTTPException(status_code=400, detail=f"Model for {ticker_upper} ({interval}) is not trained yet.")
        
    try:
        t = ticker_upper.lower()
        i = interval.lower()
        
        # Load features, models, scaler, meta (all paths resolved from project root)
        arima_path = os.path.join(PROJECT_ROOT, f"models/arima_{t}_{i}.pkl")
        lstm_path = os.path.join(PROJECT_ROOT, f"models/lstm_{t}_{i}.pth")
        scaler_path = os.path.join(PROJECT_ROOT, f"models/scaler_{t}_{i}.pkl")
        meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{t}_{i}.pkl")
        
        if i == "1d" and not os.path.exists(arima_path):
            arima_path = os.path.join(PROJECT_ROOT, f"models/arima_{t}.pkl")
            lstm_path = os.path.join(PROJECT_ROOT, f"models/lstm_{t}.pth")
            scaler_path = os.path.join(PROJECT_ROOT, f"models/scaler_{t}.pkl")
            meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{t}.pkl")
            
        with open(arima_path, 'rb') as f:
            arima_result = pickle.load(f)
            
        lstm_model = ResidualLSTM(input_size=1, hidden_size=64, num_layers=2, output_size=1)
        lstm_model.load_state_dict(torch.load(lstm_path, weights_only=True))
        lstm_model.eval()
        
        scaler = joblib.load(scaler_path)
        
        with open(meta_path, 'rb') as f:
            meta_info = pickle.load(f)
            
        features_path = os.path.join(PROJECT_ROOT, f"data/features_{t}_{i}.csv")
        if i == "1d" and not os.path.exists(features_path):
            features_path = os.path.join(PROJECT_ROOT, f"data/features_{t}.csv")
            
        if not os.path.exists(features_path):
            raise HTTPException(status_code=404, detail=f"Feature dataset not found for {ticker_upper} ({interval}).")
            
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
        for i_idx in range(len(full_residuals) - seq_len):
            X_lstm.append(full_residuals[i_idx:(i_idx + seq_len)])
        X_lstm = np.array(X_lstm)
        
        with torch.no_grad():
            X_tensor = torch.tensor(X_lstm, dtype=torch.float32).unsqueeze(-1)
            lstm_scaled_preds = lstm_model(X_tensor).numpy().flatten()
            
        lstm_preds = scaler.inverse_transform(lstm_scaled_preds.reshape(-1, 1)).flatten()
        test_df['LSTM_Pred'] = lstm_preds
        test_df['Hybrid_Pred'] = test_df['ARIMA_Pred'] + test_df['LSTM_Pred']
        
        # Make one-step out prediction (tomorrow)
        last_close = float(df.iloc[-1]['Close'])
        try:
            updated_arima = arima_result.apply(df['Close'].values)
            arima_next_pred = updated_arima.forecast(steps=1)[0]
            recent_res = (df['Close'].values - updated_arima.fittedvalues)[-seq_len:]
        except Exception as e:
            # Fallback if apply fails
            arima_next_pred = arima_result.forecast(steps=1)[0]
            recent_res = (df['Close'].values - arima_result.predict(start=0, end=len(df)-1))[-seq_len:]
            
        scaled_recent_res = scaler.transform(recent_res.reshape(-1, 1)).flatten()
        X_lstm_next = torch.tensor(scaled_recent_res.reshape((1, seq_len, 1)), dtype=torch.float32)
        
        with torch.no_grad():
            lstm_next_scaled = lstm_model(X_lstm_next).item()
        lstm_next_pred = scaler.inverse_transform([[lstm_next_scaled]])[0][0]
        predicted_close_next = arima_next_pred + lstm_next_pred
        predicted_direction_next = "Up" if predicted_close_next > last_close else "Down"
        
        # Check if dataset has intraday dates to determine formatting
        is_intraday = df['Date'].dt.time.nunique() > 1
        date_format = '%Y-%m-%d %H:%M' if is_intraday else '%Y-%m-%d'
        
        # Helper to convert row into detailed payload for indicators/SMC
        def row_to_dict(row, type_name, arima_val=None, hybrid_val=None):
            d = {
                "date": row['Date'].strftime(date_format),
                "open": float(row['Open']),
                "high": float(row['High']),
                "low": float(row['Low']),
                "close": float(row['Close']),
                "actual": float(row['Close']),
                "volume": float(row['Volume']),
                "type": type_name,
                
                # MAs
                "sma_10": float(row['SMA_10']) if 'SMA_10' in row else None,
                "sma_20": float(row['SMA_20']) if 'SMA_20' in row else None,
                "sma_50": float(row['SMA_50']) if 'SMA_50' in row else None,
                "sma_200": float(row['SMA_200']) if 'SMA_200' in row else None,
                "ema_9": float(row['EMA_9']) if 'EMA_9' in row else None,
                "ema_20": float(row['EMA_20']) if 'EMA_20' in row else None,
                "ema_50": float(row['EMA_50']) if 'EMA_50' in row else None,
                "ema_200": float(row['EMA_200']) if 'EMA_200' in row else None,
                
                # Bollinger Bands
                "bb_upper": float(row['BB_Upper']) if 'BB_Upper' in row else None,
                "bb_lower": float(row['BB_Lower']) if 'BB_Lower' in row else None,
                "bb_mid": float(row['SMA_20']) if 'SMA_20' in row else None,
                "bb_bandwidth": float(row['BB_Bandwidth']) if 'BB_Bandwidth' in row else None,
                "bb_percent": float(row['BB_Percent']) if 'BB_Percent' in row else None,
                
                # Oscillators
                "rsi_14": float(row['RSI_14']) if 'RSI_14' in row else None,
                "stoch_k": float(row['Stoch_K']) if 'Stoch_K' in row else None,
                "stoch_d": float(row['Stoch_D']) if 'Stoch_D' in row else None,
                "cci_20": float(row['CCI_20']) if 'CCI_20' in row else None,
                
                # SMC Swing levels & zones
                "last_swing_high": float(row['Last_Swing_High']) if 'Last_Swing_High' in row else None,
                "last_swing_low": float(row['Last_Swing_Low']) if 'Last_Swing_Low' in row else None,
                "bullish_ob_high": float(row['Bullish_OB_High']) if 'Bullish_OB_High' in row else None,
                "bullish_ob_low": float(row['Bullish_OB_Low']) if 'Bullish_OB_Low' in row else None,
                "bearish_ob_high": float(row['Bearish_OB_High']) if 'Bearish_OB_High' in row else None,
                "bearish_ob_low": float(row['Bearish_OB_Low']) if 'Bearish_OB_Low' in row else None,
                
                # Breakouts, Sweeps & FVGs
                "bos": int(row['BOS']) if 'BOS' in row else 0,
                "choch": int(row['CHOCH']) if 'CHOCH' in row else 0,
                "sweep_high": int(row['Sweep_High']) if 'Sweep_High' in row else 0,
                "sweep_low": int(row['Sweep_Low']) if 'Sweep_Low' in row else 0,
                "fvg_bullish": int(row['FVG_Bullish']) if 'FVG_Bullish' in row else 0,
                "fvg_bullish_size": float(row['FVG_Bullish_Size']) if 'FVG_Bullish_Size' in row else 0.0,
                "fvg_bearish": int(row['FVG_Bearish']) if 'FVG_Bearish' in row else 0,
                "fvg_bearish_size": float(row['FVG_Bearish_Size']) if 'FVG_Bearish_Size' in row else 0.0,
                
                # Elliott Wave
                "elliott_wave": int(row['Elliott_Wave']) if 'Elliott_Wave' in row else 0
            }
            if arima_val is not None:
                d["arima"] = float(arima_val)
            if hybrid_val is not None:
                d["hybrid"] = float(hybrid_val)
            return d

        # Format history and out-of-sample data for charts (last 100 days train + all test)
        train_df_subset = df.iloc[max(0, split_idx - 100):split_idx].copy()
        
        history = []
        for _, row in train_df_subset.iterrows():
            history.append(row_to_dict(row, "train"))
            
        predictions = []
        for idx, row in test_df.iterrows():
            predictions.append(row_to_dict(
                row, 
                "test", 
                arima_val=row['ARIMA_Pred'], 
                hybrid_val=row['Hybrid_Pred']
            ))
            
        # Overall directional accuracy of hybrid model
        test_df['Actual_Dir'] = (test_df['Close'].diff() > 0).astype(int)
        test_df['Pred_Dir'] = (test_df['Hybrid_Pred'].diff() > 0).astype(int)
        correct_dir = int((test_df['Actual_Dir'].iloc[1:] == test_df['Pred_Dir'].iloc[1:]).sum())
        total_dir = len(test_df) - 1
        accuracy = correct_dir / total_dir if total_dir > 0 else 0.0

        write_log(EventType.PREDICT_FETCH, {
            "ticker": ticker_upper, "interval": interval,
            "directional_accuracy": round(accuracy, 4),
            "predicted_direction": predicted_direction_next,
            "predicted_close": round(predicted_close_next, 2)
        })

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
def get_explainability(ticker: str, interval: str = "1d"):
    ticker_upper = ticker.upper()
    if not models_exist(ticker_upper, interval):
        raise HTTPException(status_code=400, detail=f"Model for {ticker_upper} ({interval}) is not trained yet.")
        
    try:
        t = ticker_upper.lower()
        i = interval.lower()
        
        # Load LightGBM model and features (paths resolved from project root)
        lgb_path = os.path.join(PROJECT_ROOT, f"models/lgb_{t}_{i}.txt")
        meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{t}_{i}.pkl")
        
        if i == "1d" and not os.path.exists(lgb_path):
            lgb_path = os.path.join(PROJECT_ROOT, f"models/lgb_{t}.txt")
            meta_path = os.path.join(PROJECT_ROOT, f"models/meta_{t}.pkl")
            
        lgb_model = lgb.Booster(model_file=lgb_path)
        
        features_path = os.path.join(PROJECT_ROOT, f"data/features_{t}_{i}.csv")
        if i == "1d" and not os.path.exists(features_path):
            features_path = os.path.join(PROJECT_ROOT, f"data/features_{t}.csv")
            
        df = pd.read_csv(features_path)
        
        # Load meta info dynamically to get the trained list of feature columns
        with open(meta_path, 'rb') as f:
            meta_info = pickle.load(f)
            
        feature_cols = meta_info.get('feature_cols', [
            'Return_Lag_1', 'Return_Lag_2', 'Return_Lag_3', 'Return_Lag_5', 'Return_Lag_10',
            'Vol_5', 'Vol_10', 'Vol_20', 'SMA_10', 'SMA_20', 'EMA_12', 'EMA_26', 'RSI_14',
            'MACD', 'MACD_Signal', 'MACD_Hist'
        ])
        
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

        write_log(EventType.EXPLAIN_FETCH, {"ticker": ticker_upper, "interval": interval,
                                            "top_feature": contributions[0]["feature"] if contributions else None})

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
    t_lower = ticker_upper.lower()
    i_lower = req.interval.lower()
    features_path = os.path.join(PROJECT_ROOT, f"data/features_{t_lower}_{i_lower}.csv")
    if i_lower == "1d" and not os.path.exists(features_path):
        features_path = os.path.join(PROJECT_ROOT, f"data/features_{t_lower}.csv")
        
    if not os.path.exists(features_path):
        raise HTTPException(status_code=400, detail=f"Feature dataset not found for {ticker_upper} ({req.interval}). Please train the model first.")
        
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
                "start_date": r["start_date"].strftime('%Y-%m-%d %H:%M') if getattr(r["start_date"], 'hour', 0) > 0 else r["start_date"].strftime('%Y-%m-%d'),
                "end_date": r["end_date"].strftime('%Y-%m-%d %H:%M') if getattr(r["end_date"], 'hour', 0) > 0 else r["end_date"].strftime('%Y-%m-%d')
            })
            
        avg_accuracy = float(np.mean([r['accuracy'] for r in wfv_results])) if wfv_results else 0
        avg_sharpe = float(np.mean([r['sharpe'] for r in wfv_results])) if wfv_results else 0
        avg_max_dd = float(np.mean([r['max_dd'] for r in wfv_results])) if wfv_results else 0

        write_log(EventType.WFV_RUN, {"ticker": ticker_upper, "interval": req.interval,
                                      "folds": len(formatted_results), "avg_accuracy": round(avg_accuracy, 4),
                                      "avg_sharpe": round(avg_sharpe, 4)})

        return {
            "folds": formatted_results,
            "average_accuracy": avg_accuracy,
            "average_sharpe": avg_sharpe,
            "average_max_dd": avg_max_dd
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error running walk-forward validation: {e}")

@app.post("/api/monitor")
def run_monitoring_endpoint(ticker: str, interval: str = "1d"):
    ticker_upper = ticker.upper()
    if not models_exist(ticker_upper, interval):
        raise HTTPException(status_code=400, detail=f"Model for {ticker_upper} ({interval}) is not trained yet.")
        
    try:
        # Change to project root so monitor.py can find model/data files with relative paths
        orig_cwd = os.getcwd()
        os.chdir(PROJECT_ROOT)
        try:
            run_monitoring(ticker_upper, interval)
        finally:
            os.chdir(orig_cwd)
        
        t_lower = ticker_upper.lower()
        i_lower = interval.lower()
        log_path = os.path.join(PROJECT_ROOT, f"logs/monitoring_{t_lower}_{i_lower}.csv")
        if i_lower == "1d" and not os.path.exists(log_path):
            log_path = os.path.join(PROJECT_ROOT, f"logs/monitoring_{t_lower}.csv")
            
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
            
        write_log(EventType.MONITOR_RUN, {
            "ticker": ticker_upper, "interval": interval,
            "rolling_accuracy": round(rolling_acc, 4),
            "decay_warning": decay_warning,
            "evaluated_days": len(evaluated)
        })

        return {
            "rolling_accuracy": rolling_acc,
            "total_evaluated_days": len(evaluated),
            "decay_warning": decay_warning,
            "history": logs
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error running monitoring: {e}")
