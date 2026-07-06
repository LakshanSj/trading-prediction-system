# AI Stock Trend Prediction System - Task Checklist & Running Guide

All core components of the system have been successfully implemented using **PyTorch** and **LightGBM** (for fast pre-compiled Windows wheels under Python 3.14). 

---

## Running the Web App & Modules

### 1. Ingest Data, Train Model & Run Web Dashboard
To start the interactive Streamlit dashboard, run:
```bash
streamlit run app.py
```
This will launch a web browser window showing the dashboard. Through the UI, you can:
- Change the ticker (e.g. `AAPL`, `MSFT`, `TSLA`, `GOOG`).
- Select date range and model hyper-parameters.
- Ingest data and train the Hybrid model on-the-fly.
- View predictions, interactive charts, and SHAP explainability.
- Run Walk-Forward Validation and Daily monitoring simulations.

---

### 2. Running Individual Modules (CLI)

#### A. Data Fetcher
Fetches historical daily OHLCV data from Yahoo Finance:
```bash
python src/data_fetcher.py --ticker AAPL --start 2020-01-01 --end 2024-01-01
```
- Saved data path: `data/raw_aapl.csv`

#### B. Feature Engineering
Calculates technical indicators, lags, and rolling volatility:
```bash
python src/feature_engineer.py --input data/raw_aapl.csv
```
- Saved data path: `data/features_aapl.csv`

#### C. Model Training
Fits ARIMA to Close price, extracts residuals, trains PyTorch LSTM on residuals, and trains LightGBM Classifier on features:
```bash
python src/train_model.py --features data/features_aapl.csv --ticker AAPL --epochs 15
```
- Saved models directory: `models/`

#### D. Walk-Forward Validation (WFV)
Simulates rolling-window training and tests performance over time (Sharpe Ratio, Max Drawdown, Directional Accuracy):
```bash
python src/walk_forward.py --features data/features_aapl.csv --epochs 5 --train_size 750 --test_size 250 --step_size 250
```

#### E. Model Monitoring (Daily Decay Check)
Checks daily prediction performance, updates history, and warns of model decay if accuracy falls below 50%:
```bash
python src/monitor.py --ticker AAPL --min_days 5
```
- Saved tracking log: `logs/monitoring_aapl.csv`

---

## Checklist of Implemented Components

- `[x]` **Phase 1: Project Setup**
  - `[x]` Initialize Git repository
  - `[x]` Create `.gitignore` and `requirements.txt`
  - `[x]` Install python dependencies (PyTorch, LightGBM, Streamlit, yfinance, etc.)
- `[x]` **Phase 2: Core ML Engine**
  - `[x]` `src/data_fetcher.py` (Data download and standardization)
  - `[x]` `src/feature_engineer.py` (Wilder's RSI, MACD, SMAs, EMAs, return lags, volatility)
  - `[x]` `src/train_model.py` (PyTorch LSTM + statsmodels ARIMA + LightGBM training pipeline)
  - `[x]` `src/walk_forward.py` (Walk-Forward simulation, Sharpe Ratio, Max Drawdown, Accuracy)
- `[x]` **Phase 3: Explainability & Monitoring**
  - `[x]` `app.py` (Streamlit visual dashboard, interactive Plotly charts)
  - `[x]` `app.py` - LightGBM SHAP explainability (Calculates feature contribution via `pred_contrib=True`)
  - `[x]` `src/monitor.py` (Updates yesterday's predictions with actual outcomes, checks rolling accuracy, alerts if < 50%)
- `[ ]` **Phase 4: Verification & Walkthrough**
  - `[ ]` Run the end-to-end verification pipeline (`verify_system.py`)
  - `[ ]` Output system validation walkthrough
