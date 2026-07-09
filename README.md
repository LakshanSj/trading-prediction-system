# 📈 AI Stock & Crypto Prediction System

A hybrid price forecasting application combining statistical and machine learning models to predict stock and cryptocurrency trends.

---

## 💡 What the System Does
1. **Hybrid Forecasting:** Fits an **ARIMA** model on historical price trends, trains a **PyTorch LSTM** neural network on residuals to forecast deviations, and combines them for the final hybrid price prediction.
2. **Directional Classification:** Uses a **LightGBM** classifier to predict whether the asset price will move Up or Down.
3. **Explainable AI (SHAP):** Visualizes which technical indicators (RSI, MACD, Bollinger Bands, Moving Averages, etc.) had the greatest impact on the predictions.
4. **Smart Money Concepts (SMC):** Analyzes Order Blocks, Break of Structure (BOS), and Change of Character (CHOCH) for advanced price action.
5. **Admin Logging Panel:** Tracks all background training tasks, predictions, and model health metrics in real-time.

---

## 🚀 How to Run Locally

Start both the backend and frontend simultaneously with our one-click script:

1. Right-click **`start-local.ps1`** and choose **Run with PowerShell** (or run `.\start-local.ps1` in your terminal).
2. The script will automatically verify virtual environments, install dependencies, and launch the servers.
3. Access the applications:
   - **Interactive Dashboard:** `http://localhost:5173`
   - **Backend API Documentation:** `http://localhost:8000/docs`

---

## 🔐 Admin Logging Credentials
Click the **Admin** button in the top-right corner of the React dashboard to inspect system logs and stats:
- **Username:** `adminTrading`
- **Default Password:** `Admin@Trading2025!`

---

## 📂 Folder Structure
- `/src` — Core Python machine learning pipeline (ARIMA-LSTM models, technical features).
- `/src/api` — FastAPI endpoint routes and activity logging logic.
- `/frontend` — React Vite frontend dashboard (Recharts data charts).
- `start-local.ps1` — Local launcher script.
