# 📈 AI Stock & Crypto Prediction System

A machine learning price forecasting and trend prediction application combining advanced technical indicators, SMC, Elliott Wave, Fibonacci retracement levels, and Explainable AI (SHAP).

---

## 💡 What the System Does
1. **LightGBM Price Regression:** Trains a **LightGBM Regressor** directly on engineered technical features to forecast the exact numerical Close price for the next trading interval.
2. **LightGBM Trend Classification:** Trains a **LightGBM Classifier** to predict the binary direction of the next interval (Up or Down) with probability scores.
3. **Fibonacci Retracement Levels:** Computes rolling 20-period and 50-period high/low windows to calculate standard Fibonacci levels (23.6%, 38.2%, 50.0%, 61.8%, 78.6%) and feeds distance indicators directly into the predictive models.
4. **Smart Money Concepts (SMC) & Elliott Waves:** Extends standard technical analysis with Order Blocks, Break of Structure (BOS), Change of Character (CHOCH), Fair Value Gaps (FVG), premium/discount zones, and Elliott Wave indicators.
5. **Explainable AI (SHAP):** Visualizes feature importance and individual feature SHAP contribution values to explain why the model predicts an upward/downward movement.
6. **Admin Logging Panel:** Provides audit logs, event logs, and model performance metrics via real-time monitoring statistics.

---

## 🚀 How to Run Locally

Start both the backend and frontend simultaneously with our PowerShell launcher:

1. Right-click **`start-local.ps1`** and choose **Run with PowerShell** (or run `.\start-local.ps1` in your terminal).
2. The script automatically creates the virtual environment, installs dependencies from `requirements.txt`, and boots up the API and dashboard.
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
- `/src` — Core Python machine learning pipeline (LightGBM training, Fibonacci features, walk-forward validation).
- `/src/api` — FastAPI endpoint routes, admin panel auth, and activity logging logic.
- `/frontend` — React Vite frontend dashboard (Recharts charts, explainability panels).
- `start-local.ps1` — Local launcher script.
