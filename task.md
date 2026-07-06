# AI Stock Trend Prediction System — Task Checklist & Running Guide

All core ML components are implemented using **PyTorch** and **LightGBM**.
The web interface has been migrated from Streamlit to a **React (Vite) + FastAPI** stack.

---

## 🚀 How to Start the Application

### Step 1 — Start the FastAPI Backend (Terminal 1)
```powershell
# From project root
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload
```
API will be live at: `http://localhost:8000`
API Docs (Swagger): `http://localhost:8000/docs`

### Step 2 — Start the React Frontend (Terminal 2)
```powershell
# From project root
npm run dev --prefix frontend
```
Dashboard will be live at: `http://localhost:5173`

---

## 🖥️ Using the Dashboard

1. **Pick a ticker** — Type a symbol (e.g. `AAPL`) or click a quick-select tag.
2. **Set date range** — Adjust the historical data window using the date pickers.
3. **Set LSTM epochs** — Use the slider (default: 15).
4. **Click "Fetch Data & Train Model"** — Downloads Yahoo Finance data and trains the hybrid pipeline in the background. The training console log will appear.
5. **Explore tabs** after training completes:
   - 🔮 **Predictions** — Historical close prices + ARIMA & Hybrid ARIMA-LSTM test set forecasts.
   - 💡 **Explainability (SHAP)** — LightGBM feature contributions and gain-based importances.
   - 📊 **Walk-Forward Validation** — Click "Run Walk-Forward Validation" to compute rolling-fold metrics.
   - 🚨 **Monitoring & Decay** — Click "Simulate Daily Monitoring" to check model accuracy over time.

---

## 🛠️ Running Individual Modules (CLI)

### A. Data Fetcher
```bash
python src/data_fetcher.py --ticker AAPL --start 2020-01-01 --end 2024-01-01
```
Output: `data/raw_aapl.csv`

### B. Feature Engineering
```bash
python src/feature_engineer.py --input data/raw_aapl.csv
```
Output: `data/features_aapl.csv`

### C. Model Training
```bash
python src/train_model.py --features data/features_aapl.csv --ticker AAPL --epochs 15
```
Output: `models/arima_aapl.pkl`, `models/lstm_aapl.pth`, `models/lgb_aapl.txt`, `models/scaler_aapl.pkl`, `models/meta_aapl.pkl`

### D. Walk-Forward Validation
```bash
python src/walk_forward.py --features data/features_aapl.csv --epochs 5 --train_size 750 --test_size 250 --step_size 250
```

### E. Model Monitoring
```bash
python src/monitor.py --ticker AAPL --min_days 5
```
Output: `logs/monitoring_aapl.csv`

---

## ✅ Completed Phases

- `[x]` **Phase 1: Project Setup**
  - `[x]` Initialize Git repository, `.gitignore`, `requirements.txt`
  - `[x]` Create Python 3.14 virtual environment (`.venv`) with precompiled Windows wheels
  - `[x]` Install all ML and API dependencies

- `[x]` **Phase 2: Core ML Engine**
  - `[x]` `src/data_fetcher.py` — Yahoo Finance data download
  - `[x]` `src/feature_engineer.py` — RSI, MACD, SMAs, EMAs, return lags, volatility
  - `[x]` `src/train_model.py` — ARIMA + LSTM residual model + LightGBM classifier pipeline
  - `[x]` `src/walk_forward.py` — Rolling-window validation with Sharpe, Max Drawdown, Accuracy
  - `[x]` `src/monitor.py` — Daily prediction outcome tracking and decay alerts

- `[x]` **Phase 3: Web Dashboard (React + FastAPI)**
  - `[x]` `src/api/main.py` — REST API with CORS, background training, predictions, SHAP, WFV, monitoring endpoints
  - `[x]` `frontend/src/App.jsx` — React dashboard with training console, Recharts charts, tabs
  - `[x]` `frontend/src/App.css` — Glassmorphism dark theme, animated status badges, neon accents
  - `[x]` Fixed all backend bugs: absolute path resolution, `torch.load` deprecation, status key mismatch, `walk_forward` bare return

---

## 📋 What To Do Next (Remaining Work)

### Priority 1 — Verify End-to-End Flow *(Do this first)*
- `[ ]` Open the dashboard at `http://localhost:5173` and train a model for `AAPL`
- `[ ]` Confirm the training console log appears and polls correctly during background training
- `[ ]` After training completes, verify the Predictions chart renders actual + ARIMA + Hybrid lines
- `[ ]` Check the Explainability tab: SHAP bar chart and feature importance table load correctly
- `[ ]` Run Walk-Forward Validation and confirm the fold metrics table populates
- `[ ]` Run Daily Monitoring simulation and verify the prediction log table renders

### Priority 2 — Improve Prediction Quality
- `[ ]` **Tune ARIMA order** — Currently hardcoded to `(5, 1, 0)`. Add auto-ARIMA (pmdarima) to automatically select the best `(p, d, q)` order per ticker.
- `[ ]` **Increase LSTM capacity** — Try `hidden_size=128`, `num_layers=3`, dropout layers, and learning rate scheduling.
- `[ ]` **Add more features** — Bollinger Bands, ATR (Average True Range), OBV (On-Balance Volume), Stochastic RSI.
- `[ ]` **Ensemble direction voting** — Combine ARIMA-LSTM hybrid signal with LightGBM classification score to produce a final confidence-weighted prediction.

### Priority 3 — Production Hardening
- `[ ]` **Add authentication** — Protect the API with API key headers or basic auth (especially if exposed publicly).
- `[ ]` **Persistent training status** — Currently training state lives in memory. Use a SQLite or Redis store so server restarts don't lose state.
- `[ ]` **Model versioning** — Save timestamped model snapshots so you can roll back to a previous version if a retrain degrades accuracy.
- `[ ]` **Auto-retraining schedule** — Use a cron job or APScheduler inside FastAPI to retrain models automatically when monitoring detects decay (accuracy < 50%).
- `[ ]` **Docker containerization** — Create a `Dockerfile` and `docker-compose.yml` to run backend + frontend together as a portable container stack.

### Priority 4 — UI/UX Enhancements
- `[ ]` **Confidence interval bands** — Add shaded areas around the forecast line on the Predictions chart using the ARIMA model's confidence intervals.
- `[ ]` **Volume subplot** — Add a secondary chart panel below the price chart showing daily trading volume bars.
- `[ ]` **Multi-ticker comparison** — Allow side-by-side comparison of predictions and metrics for 2–3 tickers simultaneously.
- `[ ]` **Dark/Light theme toggle** — Add a theme toggle button in the header.
- `[ ]` **Export to CSV** — Add a button to export prediction tables and monitoring logs to `.csv`.

### Priority 5 — Deployment
- `[ ]` **Deploy backend** — Host the FastAPI server on a cloud service (e.g. Railway, Render, or an AWS EC2/Lambda).
- `[ ]` **Deploy frontend** — Build the React app (`npm run build`) and deploy to Vercel or Netlify.
- `[ ]` **Update API base URL** — Change `API_BASE_URL` in `frontend/src/App.jsx` from `localhost:8000` to the deployed backend URL.
- `[ ]` **Set up HTTPS** — Ensure the deployed backend uses HTTPS to avoid mixed-content browser errors.
- `[ ]` **Set CORS to specific origin** — Lock `allow_origins` in `main.py` to the deployed frontend URL instead of `"*"`.

---

## 📁 Project Structure

```
trading-prediction-system/
├── .venv/                     # Python virtual environment (Python 3.14)
├── frontend/                  # React + Vite web dashboard
│   ├── src/
│   │   ├── App.jsx            # Main dashboard component
│   │   ├── App.css            # Dark glassmorphism styles
│   │   └── index.css          # Global resets
│   ├── index.html             # Entry HTML (Google Fonts, title)
│   └── package.json           # npm dependencies (recharts, lucide-react)
├── src/
│   ├── api/
│   │   └── main.py            # FastAPI backend (6 REST endpoints)
│   ├── data_fetcher.py        # Yahoo Finance data ingestion
│   ├── feature_engineer.py    # Technical indicator engineering
│   ├── train_model.py         # ARIMA + LSTM + LightGBM training pipeline
│   ├── walk_forward.py        # Rolling walk-forward validation
│   └── monitor.py             # Daily monitoring and decay alerts
├── app.py                     # Original Streamlit dashboard (archived)
├── models/                    # Saved model artifacts (auto-created)
├── data/                      # CSV data files (auto-created)
├── logs/                      # Monitoring logs (auto-created)
├── requirements.txt           # Python dependencies
└── task.md                    # This file
```
