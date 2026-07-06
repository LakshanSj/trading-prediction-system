# AI Stock & Crypto Prediction System

A hybrid price forecasting system combining statsmodels ARIMA, PyTorch LSTM (modeled on residuals), and LightGBM Classifiers.

---

## 🛠️ Tech Stack
- **Backend:** FastAPI, statsmodels, PyTorch, LightGBM, yfinance
- **Frontend:** React (Vite), Recharts, Lucide Icons, Glassmorphism CSS

---

## 🚀 How to Run Locally

### 1. Start FastAPI Backend
```powershell
# From project root
.\.venv\Scripts\python.exe -m uvicorn src.api.main:app --port 8000 --reload
```
API Docs will be live at: `http://localhost:8000/docs`

### 2. Start React Frontend
```powershell
# From project root
npm run dev --prefix frontend
```
The local dashboard will be live at: `http://localhost:5173`

---

## 🌐 Hybrid Deployment (Local Backend + Firebase Frontend)

To keep ML computations free on your laptop while serving the UI globally:

### 1. Tunnel Local Backend (ngrok)
Expose your backend port (8000) using ngrok:
```powershell
ngrok http --url=https://YOUR_DOMAIN.ngrok-free.dev 8000
```

### 2. Build Frontend
Update `frontend/.env.production` with your ngrok URL:
```env
VITE_API_URL=https://YOUR_DOMAIN.ngrok-free.dev
```
Then build the client production assets:
```powershell
npm run build --prefix frontend
```

### 3. Deploy Frontend (Firebase Hosting)
```powershell
firebase login
firebase use YOUR_PROJECT_ID
firebase deploy --only hosting
```
The web dashboard goes live at `https://YOUR_PROJECT_ID.web.app`

---

## 📂 Project Structure
- `/src` — Python modules for data fetching, feature engineering, ARIMA-LSTM, WFV, and monitoring.
- `/src/api` — REST API endpoint routing (`main.py`).
- `/frontend` — React Vite client application.
- `start-backend.ps1` — One-click launcher script for uvicorn and the ngrok tunnel.
