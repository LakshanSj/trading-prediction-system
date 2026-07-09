# 📈 AI Stock & Crypto Prediction System (Local Development)

A full-stack hybrid price forecasting system combining **ARIMA**, **PyTorch LSTM** (residual modelling), and **LightGBM** classifiers — with an Explainable AI (SHAP) dashboard, Smart Money Concepts (SMC) analysis, Walk-Forward Validation, model decay monitoring, and a built-in **Admin Logging Panel**.

This setup is optimized for **purely local execution** on your machine.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI + Uvicorn |
| ML Models | statsmodels ARIMA, PyTorch LSTM, LightGBM |
| Data Source | yfinance (Yahoo Finance) |
| Explainability | LightGBM `pred_contrib` (SHAP-like) |
| Frontend | React 19 + Vite, Recharts, Lucide Icons |
| Logging | Structured JSON-lines activity log (`logs/admin_activity.jsonl`) |

---

## 🚀 Running Locally

You can launch both the backend and frontend simultaneously with a single PowerShell script:

### The One-Click Way (Windows)
1. Right-click [start-local.ps1](file:///c:/Drive/Trading/trading-prediction-system/start-local.ps1) and choose **Run with PowerShell**, or execute:
   ```powershell
   .\start-local.ps1
   ```
2. The script will automatically check if you have virtual environments and frontend dependencies installed, prompt to install them if missing, and launch both servers.
3. Open your browser to:
   - **React Dashboard:** `http://localhost:5173`
   - **FastAPI Interactive Docs:** `http://localhost:8000/docs`

---

### The Manual Way

If you prefer to start them manually in separate terminal windows:

#### 1. Start FastAPI Backend
```powershell
# Create & activate virtual environment (first time)
py -3.11 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# Run the FastAPI app
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload
```
- API root: `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

#### 2. Start React Frontend
```powershell
cd frontend
npm install
npm run dev
```
Dashboard live at: `http://localhost:5173`

> **Note:** Vite proxies all `/api`, `/admin`, and `/health` requests to `http://localhost:8000` automatically — no CORS issues during local development.

---

## 🔐 Admin Logging Panel

A secure admin dashboard is built into the app. Click the **Admin** button in the top-right corner of the dashboard.

### Default Credentials
| Field | Value |
|---|---|
| Username | `adminTrading` |
| Default Password | `Admin@Trading2025!` |

### What the Admin Panel Shows
- **Activity Logs** — Every API call logged (training, predictions, WFV, monitoring) with timestamps, ticker tags, and expandable JSON details
- **System Statistics** — Counts of training runs, prediction fetches, WFV runs, failed logins, and more
- **Filter by event type** — TRAIN, ADMIN, PREDICT, MONITOR, WFV, SYSTEM
- **Clear Logs** — Wipe all activity logs (requires confirm click)

Log file location: `logs/admin_activity.jsonl`

---

## 🔑 Changing the Admin Password

### Step 1 — Generate the SHA-256 hash of your new password

**Option A — PowerShell:**
```powershell
$password = "YourNewPassword123!"
$bytes = [System.Text.Encoding]::UTF8.GetBytes($password)
$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
($hash | ForEach-Object { $_.ToString("x2") }) -join ""
```

**Option B — Python:**
```python
import hashlib
password = "YourNewPassword123!"
print(hashlib.sha256(password.encode()).hexdigest())
```

### Step 2 — Set the environment variable
Set it in your terminal session before starting the backend:
```powershell
$env:ADMIN_PASSWORD_HASH = "your_hex_hash_here"
.\start-local.ps1
```

---

## 📂 Project Structure

```
trading-prediction-system/
├── src/
│   ├── api/
│   │   ├── main.py            # FastAPI app — all REST endpoints
│   │   ├── admin.py           # Admin auth & log viewer endpoints
│   │   └── admin_logger.py    # Structured JSON-lines activity logger
│   ├── data_fetcher.py        # yfinance download + CSV export
│   ├── feature_engineer.py    # Technical indicators, SMC, Elliott Wave
│   ├── train_model.py         # ARIMA + LSTM + LightGBM pipeline
│   ├── walk_forward.py        # Rolling-window validation
│   └── monitor.py             # Daily prediction & decay tracking
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Main dashboard (predictions, SHAP, WFV, monitoring)
│   │   ├── AdminPanel.jsx     # Admin login + log dashboard component
│   │   └── App.css            # Full dark-mode design system
│   ├── .env                   # Local dev (VITE_API_URL= empty, uses Vite proxy)
│   └── vite.config.js         # Vite build config + /api /admin /health proxy
├── models/                    # Saved model files (gitignored)
├── data/                      # Feature-engineered CSVs (gitignored)
├── logs/
│   ├── admin_activity.jsonl   # Admin activity log (all API events)
│   └── monitoring_*.csv       # Per-ticker daily prediction logs
├── requirements.txt           # Python dependencies
└── start-local.ps1            # One-click local launcher (FastAPI + Vite)
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/api/ticker-status` | Model trained / untrained / training status |
| `POST` | `/api/train` | Start background training pipeline |
| `GET` | `/api/predictions` | Fetch predictions & chart data |
| `GET` | `/api/explainability` | SHAP-like feature contributions |
| `POST` | `/api/wfv` | Run Walk-Forward Validation |
| `POST` | `/api/monitor` | Run daily monitoring simulation |
| `POST` | `/admin/login` | Admin login (returns session token) |
| `GET` | `/admin/verify` | Verify admin token is still valid |
| `POST` | `/admin/logout` | Invalidate admin session |
| `GET` | `/admin/logs` | Fetch activity logs (auth required) |
| `GET` | `/admin/stats` | System statistics (auth required) |
| `DELETE` | `/admin/logs/clear` | Clear all logs (auth required) |

Full interactive API docs: `http://localhost:8000/docs`
