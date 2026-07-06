import os
import sys
import pickle
import joblib
import pandas as pd
import numpy as np
import streamlit as st
import plotly.graph_objects as go
from datetime import datetime, timedelta

# Add src to python path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

try:
    from data_fetcher import fetch_data
    from feature_engineer import engineer_features
    from train_model import train_pipeline, ResidualLSTM
    from walk_forward import run_wfv
    from monitor import run_monitoring
except ImportError:
    # If paths are different during direct run
    from src.data_fetcher import fetch_data
    from src.feature_engineer import engineer_features
    from src.train_model import train_pipeline, ResidualLSTM
    from src.walk_forward import run_wfv
    from src.monitor import run_monitoring

# Set Streamlit Page Config
st.set_page_config(
    page_title="AI Stock Trend Prediction System",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom Styling (Dark-themed premium look)
st.markdown("""
<style>
    .reportview-container {
        background: #0e1117;
    }
    .metric-card {
        background-color: #1e222b;
        padding: 20px;
        border-radius: 10px;
        border: 1px solid #2e333d;
        text-align: center;
    }
    .metric-label {
        font-size: 14px;
        color: #8a909d;
    }
    .metric-value {
        font-size: 28px;
        font-weight: bold;
        margin-top: 5px;
    }
    .dir-up {
        color: #00e676;
    }
    .dir-down {
        color: #ff1744;
    }
</style>
""", unsafe_allow_html=True)

# Helper function to check if models exist
def models_exist(ticker: str, interval: str = "1d") -> bool:
    t = ticker.lower()
    i = interval.lower()
    new_format = (
        os.path.exists(f"models/arima_{t}_{i}.pkl") and
        os.path.exists(f"models/lstm_{t}_{i}.pth") and
        os.path.exists(f"models/lgb_{t}_{i}.txt") and
        os.path.exists(f"models/scaler_{t}_{i}.pkl") and
        os.path.exists(f"models/meta_{t}_{i}.pkl")
    )
    if new_format:
        return True
    if i == "1d":
        return (
            os.path.exists(f"models/arima_{t}.pkl") and
            os.path.exists(f"models/lstm_{t}.pth") and
            os.path.exists(f"models/lgb_{t}.txt") and
            os.path.exists(f"models/scaler_{t}.pkl") and
            os.path.exists(f"models/meta_{t}.pkl")
        )
    return False

# Header Section
st.title("📈 AI Stock Trend Prediction System")
st.markdown("A hybrid ARIMA-LSTM forecasting framework with LightGBM-SHAP explainability and model decay monitoring.")

# Sidebar Configuration
st.sidebar.header("⚙️ Configuration")
ticker_input = st.sidebar.text_input("Stock Ticker", value="AAPL").strip().upper()

# Interval selection
interval_input = st.sidebar.selectbox("Data Interval / Timeframe", 
    options=["5m", "30m", "1h", "3h", "12h", "1d", "3d", "1wk"], 
    index=5,
    format_func=lambda x: {
        "5m": "5 Minutes", "30m": "30 Minutes", "1h": "1 Hour", 
        "3h": "3 Hours", "12h": "12 Hours", "1d": "1 Day (Daily)", 
        "3d": "3 Days", "1wk": "1 Week (Weekly)"
    }[x]
)

# Dates selection
col1, col2 = st.sidebar.columns(2)
with col1:
    start_date = st.date_input("Start Date", value=datetime(2015, 1, 1))
with col2:
    end_date = st.date_input("End Date", value=datetime.today())

st.sidebar.markdown("---")
st.sidebar.subheader("Model Parameters")
epochs_input = st.sidebar.slider("LSTM Epochs", min_value=1, max_value=50, value=15)

# Sidebar actions
st.sidebar.subheader("Actions")
train_btn = st.sidebar.button("Fetch Data & Train Model", use_container_width=True)
wfv_btn = st.sidebar.button("Run Walk-Forward Validation", use_container_width=True)
monitor_btn = st.sidebar.button("Simulate Daily Monitor Run", use_container_width=True)

# Application Logic
if train_btn:
    with st.status(f"Pipeline running for {ticker_input}...", expanded=True) as status:
        st.write("📥 Fetching historical data from Yahoo Finance...")
        try:
            raw_path = fetch_data(ticker_input, start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"), interval=interval_input)
            st.write(f"Raw data saved to {raw_path}")
            
            st.write("🛠️ Engineering technical features...")
            features_path = engineer_features(raw_path)
            st.write(f"Feature-engineered data saved to {features_path}")
            
            st.write("🤖 Training Hybrid ARIMA-LSTM & LightGBM Models...")
            train_pipeline(features_path, ticker_input, interval=interval_input, epochs=epochs_input)
            
            status.update(label="Training complete! Models saved.", state="complete", expanded=True)
            st.success(f"Models successfully trained and saved for {ticker_input} ({interval_input})!")
        except Exception as e:
            status.update(label="Pipeline failed!", state="error", expanded=True)
            st.error(f"Error during training pipeline: {e}")

# Check if model has been trained for this ticker
if not models_exist(ticker_input, interval_input):
    st.info(f"👈 Model for ticker **{ticker_input}** at interval **{interval_input}** is not trained yet. Please configure the settings and click **'Fetch Data & Train Model'** in the sidebar to begin!")
else:
    # Load Models and Meta info
    try:
        t_low = ticker_input.lower()
        i_low = interval_input.lower()
        arima_path = f"models/arima_{t_low}_{i_low}.pkl"
        lstm_path = f"models/lstm_{t_low}_{i_low}.pth"
        lgb_path = f"models/lgb_{t_low}_{i_low}.txt"
        scaler_path = f"models/scaler_{t_low}_{i_low}.pkl"
        meta_path = f"models/meta_{t_low}_{i_low}.pkl"
        
        # Legacy daily fallback
        if i_low == "1d" and not os.path.exists(arima_path):
            arima_path = f"models/arima_{t_low}.pkl"
            lstm_path = f"models/lstm_{t_low}.pth"
            lgb_path = f"models/lgb_{t_low}.txt"
            scaler_path = f"models/scaler_{t_low}.pkl"
            meta_path = f"models/meta_{t_low}.pkl"
            
        with open(arima_path, 'rb') as f:
            arima_result = pickle.load(f)
            
        import torch
        lstm_model = ResidualLSTM(input_size=1, hidden_size=64, num_layers=2, output_size=1)
        lstm_model.load_state_dict(torch.load(lstm_path))
        lstm_model.eval()
        
        scaler = joblib.load(scaler_path)
        
        with open(meta_path, 'rb') as f:
            meta_info = pickle.load(f)
            
        # Load Features for Dashboard rendering
        features_path = f"data/features_{t_low}_{i_low}.csv"
        if i_low == "1d" and not os.path.exists(features_path):
            features_path = f"data/features_{t_low}.csv"
        df_features = pd.read_csv(features_path)
        df_features['Date'] = pd.to_datetime(df_features['Date'])
        
    except Exception as e:
        st.error(f"Error loading models or features for {ticker_input}: {e}")
        st.stop()
        
    # Run WFV handler
    wfv_results = None
    if wfv_btn:
        st.markdown("---")
        with st.spinner(f"Running Walk-Forward Validation for {ticker_input} (this may take a minute)..."):
            try:
                # Capture terminal outputs if we want, or run WFV
                wfv_results = run_wfv(features_path, train_size=750, test_size=250, step_size=250, epochs=5)
                st.success("Walk-Forward Validation complete!")
            except Exception as e:
                st.error(f"Error during WFV: {e}")
                
    # Run Monitoring handler
    if monitor_btn:
        st.markdown("---")
        with st.spinner(f"Running Monitoring update for {ticker_input} ({interval_input})..."):
            try:
                run_monitoring(ticker_input, interval=interval_input)
                st.success("Daily monitoring simulation run complete!")
            except Exception as e:
                st.error(f"Error running monitor: {e}")
                
    # Create Tabs
    tab1, tab2, tab3, tab4 = st.tabs([
        "🔮 Prediction & Performance",
        "💡 SHAP Explainability",
        "📊 Walk-Forward Validation",
        "🚨 Monitoring & Decay"
    ])
    
    # --- TAB 1: PREDICTION & PERFORMANCE ---
    with tab1:
        st.subheader("Latest Predictions & Test Set Performance")
        
        # Make one-step out prediction (tomorrow)
        last_row = df_features.iloc[-1]
        last_close = float(last_row['Close'])
        
        try:
            updated_arima = arima_result.apply(df_features['Close'].values)
            arima_next_pred = updated_arima.forecast(steps=1)[0]
            recent_residuals = (df_features['Close'].values - updated_arima.fittedvalues)[-meta_info['seq_length']:]
        except Exception as e:
            st.warning(f"ARIMA apply failed: {e}. Falling back to default prediction.")
            arima_next_pred = arima_result.forecast(steps=1)[0]
            recent_residuals = (df_features['Close'].values - arima_result.predict(start=0, end=len(df_features)-1))[-meta_info['seq_length']:]
            
        scaled_recent_res = scaler.transform(recent_residuals.reshape(-1, 1)).flatten()
        X_lstm_next = torch.tensor(scaled_recent_res.reshape((1, meta_info['seq_length'], 1)), dtype=torch.float32)
        
        with torch.no_grad():
            lstm_next_scaled_pred = lstm_model(X_lstm_next).item()
        lstm_next_pred = scaler.inverse_transform([[lstm_next_scaled_pred]])[0][0]
        
        predicted_close = arima_next_pred + lstm_next_pred
        predicted_direction = "Up" if predicted_close > last_close else "Down"
        dir_class = "dir-up" if predicted_direction == "Up" else "dir-down"
        dir_arrow = "▲" if predicted_direction == "Up" else "▼"
        
        # Display Metric Cards
        m_col1, m_col2, m_col3, m_col4 = st.columns(4)
        with m_col1:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-label">Latest Close Price</div>
                <div class="metric-value">${last_close:.2f}</div>
            </div>
            """, unsafe_allow_html=True)
        with m_col2:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-label">Predicted Close Price</div>
                <div class="metric-value">${predicted_close:.2f}</div>
            </div>
            """, unsafe_allow_html=True)
        with m_col3:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-label">Predicted Direction</div>
                <div class="metric-value {dir_class}">{dir_arrow} {predicted_direction}</div>
            </div>
            """, unsafe_allow_html=True)
        with m_col4:
            # Simple Directional accuracy from test data
            split_idx = int(len(df_features) * 0.8)
            test_df = df_features.iloc[split_idx:].copy()
            arima_test_preds = arima_result.forecast(steps=len(test_df))
            test_df['ARIMA_Pred'] = arima_test_preds
            test_df['Residual'] = test_df['Close'] - test_df['ARIMA_Pred']
            
            # LSTM residuals
            test_res = test_df['Residual'].values.reshape(-1, 1)
            scaled_test_res = scaler.transform(test_res).flatten()
            scaled_train_res = scaler.transform((df_features.iloc[:split_idx]['Close'] - arima_result.fittedvalues).values.reshape(-1, 1)).flatten()
            
            full_res = np.concatenate([scaled_train_res[-meta_info['seq_length']:], scaled_test_res])
            X_test_l, _ = create_lstm_sequences(full_res, meta_info['seq_length'])
            X_test_tensor = torch.tensor(X_test_l, dtype=torch.float32).unsqueeze(-1)
            
            with torch.no_grad():
                lstm_test_scaled = lstm_model(X_test_tensor).numpy().flatten()
            lstm_test_preds = scaler.inverse_transform(lstm_test_scaled.reshape(-1, 1)).flatten()
            
            test_df['LSTM_Pred'] = lstm_test_preds
            test_df['Hybrid_Pred'] = test_df['ARIMA_Pred'] + test_df['LSTM_Pred']
            
            # Direction
            test_df['Actual_Dir'] = (test_df['Close'].diff() > 0).astype(int)
            test_df['Pred_Dir'] = (test_df['Hybrid_Pred'].diff() > 0).astype(int)
            correct = (test_df['Actual_Dir'].iloc[1:] == test_df['Pred_Dir'].iloc[1:]).sum()
            acc = correct / (len(test_df) - 1)
            
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-label">Test Set Directional Acc.</div>
                <div class="metric-value">{acc:.2%}</div>
            </div>
            """, unsafe_allow_html=True)
            
        st.markdown("<br>", unsafe_allow_html=True)
        
        # Plotly Actual vs Predicted
        st.subheader("Historical vs Out-of-Sample Predictions (Test Set)")
        
        # Interactive chart range filtering controls
        zoom_opt = st.radio("Zoom Range", ["All", "1w", "3d", "1d", "12h", "3h", "1h", "30min", "5min", "Custom"], horizontal=True)
        
        filtered_df = test_df.copy()
        train_df_subset = df_features.iloc[max(0, split_idx-100):split_idx].copy()
        filtered_train_subset = train_df_subset.copy()
        
        if zoom_opt != "All":
            max_date = df_features['Date'].max()
            if zoom_opt == "1w":
                start_limit = max_date - timedelta(days=7)
            elif zoom_opt == "3d":
                start_limit = max_date - timedelta(days=3)
            elif zoom_opt == "1d":
                start_limit = max_date - timedelta(days=1)
            elif zoom_opt == "12h":
                start_limit = max_date - timedelta(hours=12)
            elif zoom_opt == "3h":
                start_limit = max_date - timedelta(hours=3)
            elif zoom_opt == "1h":
                start_limit = max_date - timedelta(hours=1)
            elif zoom_opt == "30min":
                start_limit = max_date - timedelta(minutes=30)
            elif zoom_opt == "5min":
                start_limit = max_date - timedelta(minutes=5)
            elif zoom_opt == "Custom":
                col_c1, col_c2 = st.columns(2)
                with col_c1:
                    custom_start = st.text_input("Custom Start Date/Time", value=str(max_date - timedelta(days=5)))
                with col_c2:
                    custom_end = st.text_input("Custom End Date/Time", value=str(max_date))
                try:
                    start_limit = pd.to_datetime(custom_start)
                    end_limit = pd.to_datetime(custom_end)
                    filtered_df = filtered_df[(filtered_df['Date'] >= start_limit) & (filtered_df['Date'] <= end_limit)]
                    filtered_train_subset = filtered_train_subset[(filtered_train_subset['Date'] >= start_limit) & (filtered_train_subset['Date'] <= end_limit)]
                except:
                    st.warning("Invalid custom dates.")
                    start_limit = None
            
            if zoom_opt != "Custom":
                filtered_df = filtered_df[filtered_df['Date'] >= start_limit]
                filtered_train_subset = filtered_train_subset[filtered_train_subset['Date'] >= start_limit]
                
        fig = go.Figure()
        
        # Train close context
        fig.add_trace(go.Scatter(
            x=filtered_train_subset['Date'], 
            y=filtered_train_subset['Close'],
            name="Train Actual Close", 
            line=dict(color="#8a909d", width=2)
        ))
        
        # Test actual close
        fig.add_trace(go.Scatter(
            x=filtered_df['Date'], 
            y=filtered_df['Close'],
            name="Test Actual Close", 
            line=dict(color="#00e676", width=2)
        ))
        
        # Test predicted close
        fig.add_trace(go.Scatter(
            x=filtered_df['Date'], 
            y=filtered_df['Hybrid_Pred'],
            name="Test Hybrid Predict Close", 
            line=dict(color="#2979ff", width=2, dash='dash')
        ))
        
        fig.update_layout(
            template="plotly_dark",
            title=f"Actual vs predicted stock price for {ticker_input} ({interval_input})",
            xaxis_title="Date",
            yaxis_title="Stock Price ($)",
            hovermode="x unified",
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1)
        )
        
        st.plotly_chart(fig, use_container_width=True)
        
    # --- TAB 2: SHAP EXPLAINABILITY ---
    with tab2:
        st.subheader("Explainable AI (SHAP Feature Contributions)")
        st.markdown("""
        To demystify the machine learning model, we use a LightGBM surrogate model trained on the technical features.
        The SHAP values below show how individual technical indicators contributed to the model's prediction for the next day.
        """)
        
        # Load LightGBM model
        lgb_model = lgb.Booster(model_file=lgb_path)
        
        # Prepare latest row features
        feature_cols = meta_info['feature_cols']
        latest_features = df_features[feature_cols].iloc[-1:]
        
        # Get SHAP values using pred_contrib
        # returns array of shape (1, num_features + 1)
        contribs = lgb_model.predict(latest_features, pred_contrib=True)[0]
        
        # Extract features and their contribution
        shap_values = contribs[:-1]
        base_value = contribs[-1]
        
        shap_df = pd.DataFrame({
            'Feature': feature_cols,
            'Contribution (SHAP)': shap_values
        })
        
        # Sort by absolute impact
        shap_df['Absolute Impact'] = shap_df['Contribution (SHAP)'].abs()
        shap_df = shap_df.sort_values('Absolute Impact', ascending=False).reset_index(drop=True)
        
        # Display top 3
        st.write("### Top 3 Most Influential Features for Tomorrow's Prediction")
        top_cols = st.columns(3)
        for i in range(min(3, len(shap_df))):
            feat = shap_df.at[i, 'Feature']
            val = shap_df.at[i, 'Contribution (SHAP)']
            abs_val = shap_df.at[i, 'Absolute Impact']
            val_direction = "Pushed prediction UP" if val > 0 else "Pushed prediction DOWN"
            color = "green" if val > 0 else "red"
            
            with top_cols[i]:
                st.markdown(f"""
                <div class="metric-card">
                    <div style="font-size: 16px; font-weight: bold; color: #fff;">{feat}</div>
                    <div style="font-size: 24px; font-weight: bold; margin-top: 10px; color: {color};">
                        {val:+.4f}
                    </div>
                    <div style="font-size: 12px; color: #8a909d; margin-top: 5px;">{val_direction}</div>
                </div>
                """, unsafe_allow_html=True)
                
        # Interactive plot of feature importance
        st.markdown("<br>", unsafe_allow_html=True)
        st.subheader("All Feature Contributions")
        
        shap_df = shap_df.sort_values('Contribution (SHAP)', ascending=True)
        
        fig_shap = go.Figure(go.Bar(
            x=shap_df['Contribution (SHAP)'],
            y=shap_df['Feature'],
            orientation='h',
            marker_color=np.where(shap_df['Contribution (SHAP)'] > 0, '#00e676', '#ff1744')
        ))
        
        fig_shap.update_layout(
            template="plotly_dark",
            title="Feature Contributions (SHAP Values)",
            xaxis_title="SHAP Value (Impact on Prediction Probability)",
            yaxis_title="Feature",
            height=500
        )
        
        st.plotly_chart(fig_shap, use_container_width=True)
        
        # Explanation guidelines
        st.markdown("""
        **How to interpret SHAP contributions:**
        - **Positive SHAP Value (Green)**: The feature's current value increases the probability of an **Up** price trend prediction.
        - **Negative SHAP Value (Red)**: The feature's current value decreases the probability of an **Up** prediction (indicating downward pressure).
        - **Magnitude**: The larger the absolute value, the more important this feature was in making tomorrow's decision.
        """)
        
    # --- TAB 3: WALK-FORWARD VALIDATION ---
    with tab3:
        st.subheader("Walk-Forward Validation (WFV) Analysis")
        st.markdown("""
        Walk-Forward Validation simulates deploying the model in the real world. The model trains on a rolling historical window,
        tests on the subsequent period, and then slides forward to repeat.
        This provides a highly realistic assessment of model performance and controls for look-ahead bias.
        """)
        
        if wfv_results is not None:
            # Convert results to DataFrame
            wfv_df = pd.DataFrame(wfv_results)
            wfv_df['start_date'] = pd.to_datetime(wfv_df['start_date']).dt.strftime('%Y-%m-%d')
            wfv_df['end_date'] = pd.to_datetime(wfv_df['end_date']).dt.strftime('%Y-%m-%d')
            
            # Show summary
            w_col1, w_col2, w_col3 = st.columns(3)
            with w_col1:
                st.metric("Average Directional Accuracy", f"{wfv_df['accuracy'].mean():.2%}")
            with w_col2:
                st.metric("Average Annualized Sharpe Ratio", f"{wfv_df['sharpe'].mean():.4f}")
            with w_col3:
                st.metric("Average Maximum Drawdown", f"{wfv_df['max_dd'].mean():.2%}")
                
            st.markdown("<br>", unsafe_allow_html=True)
            st.write("### Performance by Validation Fold")
            
            # Format dataframe for display
            display_wfv_df = wfv_df.rename(columns={
                'fold': 'Fold',
                'accuracy': 'Directional Accuracy',
                'sharpe': 'Sharpe Ratio',
                'max_dd': 'Max Drawdown',
                'start_date': 'Train Start Date',
                'end_date': 'Test End Date'
            })
            
            st.dataframe(
                display_wfv_df.style.format({
                    'Directional Accuracy': '{:.2%}',
                    'Sharpe Ratio': '{:.4f}',
                    'Max Drawdown': '{:.2%}'
                }),
                use_container_width=True
            )
        else:
            st.info("💡 Click the **'Run Walk-Forward Validation'** button in the sidebar to simulate and analyze rolling-window historical performance.")
            
    # --- TAB 4: MONITORING & DECAY ---
    with tab4:
        st.subheader("Model Performance Monitoring & Decay Tracking")
        st.markdown("""
        Models in production decay as market conditions change. This dashboard tracks yesterday's predictions against actual results
        and flags when the rolling accuracy falls below **50%**, sending an alert that retraining is required.
        """)
        
        log_path = f"logs/monitoring_{ticker_input.lower()}.csv"
        if os.path.exists(log_path):
            mon_df = pd.read_csv(log_path)
            mon_df['Date'] = pd.to_datetime(mon_df['Date'])
            mon_df = mon_df.sort_values('Date', ascending=False).reset_index(drop=True)
            
            # Check decay
            completed = mon_df.dropna(subset=['Correct']).copy()
            
            if len(completed) >= 5:
                # Calculate rolling accuracy
                last_10 = completed.head(10)
                accuracy = last_10['Correct'].mean()
                
                if accuracy < 0.50:
                    st.error(f"🚨 **Alert: Retraining Required!** The rolling accuracy over the last {len(last_10)} verified predictions has decayed to **{accuracy:.2%}** (less than the 50% threshold).")
                else:
                    st.success(f"✅ **Model Health: Healthy**. Rolling accuracy over the last {len(last_10)} verified predictions is **{accuracy:.2%}**.")
            else:
                st.warning(f"⚠️ **Insufficient History**: Currently tracking {len(completed)} verified trading days. At least 5 days are needed to evaluate decay alerts.")
                
            # Plot tracking accuracy
            st.write("### Prediction History Log")
            st.dataframe(
                mon_df.style.format({
                    'Predicted_Close': '${:.2f}',
                    'Actual_Close': lambda x: f"${x:.2f}" if not pd.isna(x) else "-",
                    'Correct': lambda x: "✅ Correct" if x == 1.0 else ("❌ Incorrect" if x == 0.0 else "-")
                }),
                use_container_width=True
            )
        else:
            st.info("💡 Monitoring log is empty. Click the **'Simulate Daily Monitor Run'** button in the sidebar to generate a daily prediction and simulate tracking.")
