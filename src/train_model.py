import os
import argparse
import pickle
import joblib
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from statsmodels.tsa.arima.model import ARIMA
import lightgbm as lgb
from sklearn.preprocessing import MinMaxScaler

# Define PyTorch LSTM model
class ResidualLSTM(nn.Module):
    def __init__(self, input_size=1, hidden_size=64, num_layers=2, output_size=1, dropout=0.2):
        super(ResidualLSTM, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(
            input_size, 
            hidden_size, 
            num_layers, 
            batch_first=True, 
            dropout=dropout if num_layers > 1 else 0.0
        )
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        # x shape: (batch_size, seq_length, input_size)
        out, _ = self.lstm(x)
        # Take the output of the last time step
        out = self.fc(out[:, -1, :])
        return out

def create_lstm_sequences(data, seq_length):
    """Creates input sequences and targets for LSTM training."""
    X, y = [], []
    for i in range(len(data) - seq_length):
        X.append(data[i:(i + seq_length)])
        y.append(data[i + seq_length])
    return np.array(X), np.array(y)

def train_lstm_model(X_train, y_train, seq_length, epochs=15, batch_size=32):
    """Trains the PyTorch LSTM model on residuals."""
    X_tensor = torch.tensor(X_train, dtype=torch.float32).unsqueeze(-1) # shape (samples, seq_length, 1)
    y_tensor = torch.tensor(y_train, dtype=torch.float32).unsqueeze(-1) # shape (samples, 1)
    
    dataset = torch.utils.data.TensorDataset(X_tensor, y_tensor)
    dataloader = torch.utils.data.DataLoader(dataset, batch_size=batch_size, shuffle=True)
    
    model = ResidualLSTM(input_size=1, hidden_size=64, num_layers=2, output_size=1, dropout=0.2)
    criterion = nn.MSELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    
    model.train()
    for epoch in range(epochs):
        epoch_loss = 0.0
        for batch_x, batch_y in dataloader:
            optimizer.zero_grad()
            outputs = model(batch_x)
            loss = criterion(outputs, batch_y)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * batch_x.size(0)
        # Print progress
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"Epoch {epoch+1}/{epochs} - Loss: {epoch_loss/len(X_train):.6f}")
            
    return model

def train_pipeline(feature_path: str, ticker: str, interval: str = "1d", arima_order=(5, 1, 0), seq_length=10, epochs=15, batch_size=32):
    """
    Runs the training pipeline:
    1. Loads features and splits data chronologically (80% train, 20% test).
    2. Fits ARIMA on Close price and extracts training residuals.
    3. Scales residuals and trains PyTorch LSTM to predict residuals.
    4. Trains LightGBM on engineered features to predict price direction (Up/Down).
    5. Saves all models and scalers.
    """
    print(f"Loading features from '{feature_path}'...")
    df = pd.read_csv(feature_path)
    
    # Ensure sorted by date
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    # Define splits chronologically
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx].copy()
    test_df = df.iloc[split_idx:].copy()
    
    # Dynamic seq_length adjustment if dataset is short
    if len(train_df) <= seq_length:
        seq_length = max(2, len(train_df) // 2)
        print(f"Adjusted seq_length to {seq_length} due to small dataset.")
    
    print(f"Data Split: Train size = {len(train_df)}, Test size = {len(test_df)}")
    
    # --- 1. Fit ARIMA on Train Close prices ---
    print(f"Fitting ARIMA{arima_order} model on Close prices...")
    train_close = train_df['Close'].values
    
    # Fit ARIMA
    arima_model = ARIMA(train_close, order=arima_order)
    arima_result = arima_model.fit()
    
    # Extract fitted values (in-sample predictions)
    fitted_vals = arima_result.fittedvalues
    train_df['ARIMA_Pred'] = fitted_vals
    
    # Calculate residuals
    train_df['Residual'] = train_df['Close'] - train_df['ARIMA_Pred']
    
    # --- 2. Scale Residuals and Train PyTorch LSTM ---
    print("Scaling residuals and training LSTM model...")
    scaler = MinMaxScaler(feature_range=(-1, 1))
    train_residuals = train_df['Residual'].values.reshape(-1, 1)
    scaled_residuals = scaler.fit_transform(train_residuals).flatten()
    
    # Create sequences for LSTM
    X_lstm, y_lstm = create_lstm_sequences(scaled_residuals, seq_length)
    
    # Train PyTorch LSTM
    lstm_model = train_lstm_model(X_lstm, y_lstm, seq_length, epochs=epochs, batch_size=batch_size)
    
    # --- 3. Train LightGBM Classifier for Explainability ---
    print("Training LightGBM Classifier for explainability...")
    df['Target_Direction'] = (df['Close'].shift(-1) > df['Close']).astype(int)
    
    # Drop last row since it won't have a shift target
    df_lgb = df.dropna().reset_index(drop=True)
    
    feature_cols = [
        'Return_Lag_1', 'Return_Lag_2', 'Return_Lag_3', 'Return_Lag_5', 'Return_Lag_10',
        'Vol_5', 'Vol_10', 'Vol_20',
        'SMA_10', 'SMA_20', 'SMA_50', 'SMA_200',
        'EMA_9', 'EMA_12', 'EMA_20', 'EMA_26', 'EMA_50', 'EMA_200',
        'Golden_Cross', 'Death_Cross', 'Dist_SMA_50', 'Dist_SMA_200',
        'MA_Stack_Spread', 'MA_Stack_Order',
        'Support_Bounce_50', 'Support_Bounce_200',
        'Resistance_Rejection_50', 'Resistance_Rejection_200',
        'RSI_14', 'MACD', 'MACD_Signal', 'MACD_Hist',
        'Stoch_K', 'Stoch_D', 'CCI_20',
        'BB_Upper', 'BB_Lower', 'BB_Bandwidth', 'BB_Percent',
        'BOS', 'CHOCH',
        'Bullish_OB_High', 'Bullish_OB_Low', 'Bearish_OB_High', 'Bearish_OB_Low',
        'Sweep_High', 'Sweep_Low',
        'FVG_Bullish', 'FVG_Bullish_Size', 'FVG_Bearish', 'FVG_Bearish_Size',
        'Elliott_Wave'
    ]
    
    # Dynamically append PDF strategy patterns if present
    pdf_features = [
        'CDL_Hammer', 'CDL_Inverted_Hammer', 'CDL_Shooting_Star', 'CDL_Doji',
        'CDL_Bullish_Engulfing', 'CDL_Bearish_Engulfing', 'CDL_Marubozu',
        'Pattern_Double_Top', 'Pattern_Double_Bottom',
        'SMC_Breaker_Bullish', 'SMC_Breaker_Bearish', 'SMC_Premium_Discount'
    ]
    for pf in pdf_features:
        if pf in df.columns:
            feature_cols.append(pf)
    
    train_df_lgb = df_lgb.iloc[:split_idx - 1]
    
    X_train_lgb = train_df_lgb[feature_cols]
    y_train_lgb = train_df_lgb['Target_Direction']
    
    lgb_train_data = lgb.Dataset(X_train_lgb, label=y_train_lgb)
    
    params = {
        'objective': 'binary',
        'metric': 'binary_logloss',
        'boosting_type': 'gbdt',
        'learning_rate': 0.05,
        'num_leaves': 31,
        'verbose': -1,
        'random_state': 42
    }
    lgb_model = lgb.train(params, lgb_train_data, num_boost_round=100)
    
    # --- 4. Evaluate on Test set ---
    print("Evaluating hybrid model on test set...")
    # ARIMA forecast on test
    test_close = test_df['Close'].values
    arima_test_preds = arima_result.forecast(steps=len(test_df))
    test_df['ARIMA_Pred'] = arima_test_preds
    test_df['Residual'] = test_df['Close'] - test_df['ARIMA_Pred']
    
    # Scale test residuals
    test_residuals = test_df['Residual'].values.reshape(-1, 1)
    scaled_test_residuals = scaler.transform(test_residuals).flatten()
    
    # Prepare LSTM sequences for test set
    full_residuals = np.concatenate([scaled_residuals[-seq_length:], scaled_test_residuals])
    X_test_lstm, _ = create_lstm_sequences(full_residuals, seq_length)
    
    # Predict residual using LSTM (PyTorch inference)
    lstm_model.eval()
    with torch.no_grad():
        X_test_tensor = torch.tensor(X_test_lstm, dtype=torch.float32).unsqueeze(-1)
        lstm_scaled_preds = lstm_model(X_test_tensor).numpy().flatten()
        
    lstm_preds = scaler.inverse_transform(lstm_scaled_preds.reshape(-1, 1)).flatten()
    
    # Combine predictions
    test_df['LSTM_Pred'] = lstm_preds
    test_df['Hybrid_Pred'] = test_df['ARIMA_Pred'] + test_df['LSTM_Pred']
    
    # Calculate performance metrics
    test_df['Actual_Dir'] = (test_df['Close'].diff() > 0).astype(int)
    test_df['Pred_Dir'] = (test_df['Hybrid_Pred'].diff() > 0).astype(int)
    
    correct_dir = (test_df['Actual_Dir'].iloc[1:] == test_df['Pred_Dir'].iloc[1:]).sum()
    total_dir = len(test_df) - 1
    accuracy = correct_dir / total_dir if total_dir > 0 else 0.0
    print(f"Test Hybrid Model Directional Accuracy: {accuracy:.2%}")
    
    # --- 5. Save all models ---
    os.makedirs("models", exist_ok=True)
    
    t_lower = ticker.lower()
    i_lower = interval.lower()
    arima_path = f"models/arima_{t_lower}_{i_lower}.pkl"
    lstm_path = f"models/lstm_{t_lower}_{i_lower}.pth" # Saved as PyTorch weights
    lgb_path = f"models/lgb_{t_lower}_{i_lower}.txt"
    scaler_path = f"models/scaler_{t_lower}_{i_lower}.pkl"
    
    # Save ARIMA
    with open(arima_path, 'wb') as f:
        pickle.dump(arima_result, f)
        
    # Save LSTM state dict
    torch.save(lstm_model.state_dict(), lstm_path)
    
    # Save LightGBM
    lgb_model.save_model(lgb_path)
    
    # Save Scaler
    joblib.dump(scaler, scaler_path)
    
    # Save some meta-info
    from datetime import datetime
    meta_info = {
        'ticker': ticker,
        'interval': interval,
        'arima_order': arima_order,
        'seq_length': seq_length,
        'feature_cols': feature_cols,
        'accuracy': float(accuracy),
        'train_size': int(len(train_df)),
        'test_size': int(len(test_df)),
        'epochs': epochs,
        'trained_at': datetime.now().isoformat()
    }
    with open(f"models/meta_{t_lower}_{i_lower}.pkl", 'wb') as f:
        pickle.dump(meta_info, f)
    
    print("All models and preprocessing parameters successfully saved to 'models/' directory.")
    print(f"ARIMA: {arima_path}")
    print(f"LSTM: {lstm_path} (PyTorch)")
    print(f"LightGBM: {lgb_path}")
    print(f"Scaler: {scaler_path}")
    return meta_info

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train hybrid ARIMA-LSTM and LightGBM model.")
    parser.add_argument("--features", type=str, required=True, help="Path to feature-engineered CSV file")
    parser.add_argument("--ticker", type=str, required=True, help="Stock ticker symbol")
    parser.add_argument("--interval", type=str, default="1d", help="Data interval/timeframe")
    parser.add_argument("--epochs", type=int, default=15, help="Number of LSTM training epochs")
    
    args = parser.parse_args()
    
    try:
        train_pipeline(args.features, args.ticker, interval=args.interval, epochs=args.epochs)
    except Exception as e:
        print(f"Error during training: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
