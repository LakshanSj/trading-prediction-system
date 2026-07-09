# 📈 AI Stock & Crypto Prediction System

A full-stack hybrid price forecasting system combining **ARIMA**, **PyTorch LSTM** (residual modelling), and **LightGBM** classifiers — with an Explainable AI (SHAP) dashboard, Smart Money Concepts (SMC) analysis, Walk-Forward Validation, model decay monitoring, and a built-in **Admin Logging Panel**.

- **Frontend (Firebase):** https://trading-prediction-system.web.app
- **Backend (Railway):** https://web-production-22037.up.railway.app

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI + Uvicorn |
| ML Models | statsmodels ARIMA, PyTorch LSTM, LightGBM |
| Data Source | yfinance (Yahoo Finance) |
| Explainability | LightGBM `pred_contrib` (SHAP-like) |
| Frontend | React 19 + Vite, Recharts, Lucide Icons |
| Hosting | Firebase Hosting (frontend) + Railway (backend) |
| Logging | Structured JSON-lines activity log (`logs/admin_activity.jsonl`) |

---

## 🚀 Running Locally

### 1. Create & activate virtual environment
```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

### 2. Start FastAPI Backend
```powershell
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload
```
- API root: `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`

### 3. Start React Frontend (in a second terminal)
```powershell
cd frontend
npm install
npm run dev
```
Dashboard live at: `http://localhost:5173`

> **Note:** Vite proxies all `/api`, `/admin`, and `/health` requests to `http://localhost:8000` automatically — no CORS issues in local dev.

---

## 🌐 Production Deployment

### Backend → Railway

1. Push your changes to GitHub (Railway auto-deploys from the connected repo).
2. Railway uses `nixpacks.toml` to build and `Procfile` to start:
   ```
   web: uvicorn src.api.main:app --host 0.0.0.0 --port $PORT
   ```
3. Set the `ADMIN_PASSWORD_HASH` environment variable on Railway (see **Changing the Admin Password** below).

### Frontend → Firebase Hosting

1. Set your backend URL in `frontend/.env.production`:
   ```env
   VITE_API_URL=https://web-production-22037.up.railway.app
   ```
2. Build the production bundle:
   ```powershell
   npm run build --prefix frontend
   ```
3. Deploy to Firebase:
   ```powershell
   firebase deploy --only hosting
   ```
   Live at: `https://trading-prediction-system.web.app`

### Hybrid (Local Backend + Public Frontend via ngrok)

Use this if Railway is unavailable and you want to run the ML pipeline locally:

```powershell
# In one terminal — start backend
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload

# In another terminal — expose it publicly
ngrok http --url=https://YOUR_DOMAIN.ngrok-free.dev 8000
```

Then update `.env.production` with the ngrok URL, rebuild, and redeploy Firebase.

Or use the one-click launcher:
```powershell
.\start-backend.ps1
```

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

**Option A — PowerShell (Windows):**
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

**Option C — Online tool:**
Go to https://emn178.github.io/online-tools/sha256.html, type your password, copy the hex output.

### Step 2 — Set the environment variable

**For Railway (production):**
1. Go to your Railway project → **Variables** tab
2. Add (or update) the variable:
   - Name: `ADMIN_PASSWORD_HASH`
   - Value: *(the hex hash from Step 1)*
3. Railway will automatically redeploy with the new password

**For local development:**
Set it in your terminal session before starting the backend:
```powershell
$env:ADMIN_PASSWORD_HASH = "your_hex_hash_here"
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload
```

### Step 3 — Verify

Open the app → click **Admin** → log in with `adminTrading` and your new password.

> **Security note:** Never commit your password or its hash to version control. Always set it as an environment variable on the server.

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
│   ├── .env.production        # Production backend URL
│   └── vite.config.js         # Vite build config + /api /admin /health proxy
├── models/                    # Saved model files (gitignored)
├── data/                      # Feature-engineered CSVs (gitignored)
├── logs/
│   ├── admin_activity.jsonl   # Admin activity log (all API events)
│   └── monitoring_*.csv       # Per-ticker daily prediction logs
├── nixpacks.toml              # Railway build config
├── Procfile                   # Railway start command
├── requirements.txt           # Python dependencies
└── start-backend.ps1          # One-click local launcher (uvicorn + ngrok)
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
