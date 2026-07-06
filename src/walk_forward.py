import os
import argparse
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from statsmodels.tsa.arima.model import ARIMA
from sklearn.preprocessing import MinMaxScaler

# Define local PyTorch LSTM model
class ResidualLSTM(nn.Module):
    def __init__(self, input_size=1, hidden_size=32, num_layers=1, output_size=1):
        super(ResidualLSTM, self).__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out

def create_lstm_sequences(data, seq_length):
    X, y = [], []
    for i in range(len(data) - seq_length):
        X.append(data[i:(i + seq_length)])
        y.append(data[i + seq_length])
    return np.array(X), np.array(y)

def calculate_sharpe_ratio(returns, risk_free_rate=0.0):
    if len(returns) == 0 or returns.std() == 0:
        return 0.0
    mean_return = returns.mean()
    std_return = returns.std()
    return np.sqrt(252) * (mean_return - risk_free_rate) / (std_return + 1e-10)

def calculate_max_drawdown(returns):
    if len(returns) == 0:
        return 0.0
    equity_curve = (1.0 + returns).cumprod()
    peaks = equity_curve.cummax()
    drawdowns = (peaks - equity_curve) / peaks
    return drawdowns.max()

def run_wfv(feature_path: str, train_size=750, test_size=250, step_size=250, seq_length=10, arima_order=(5, 1, 0), epochs=5):
    """
    Executes walk-forward validation on feature-engineered stock data using PyTorch.
    """
    print(f"Loading features for Walk-Forward Validation from '{feature_path}'...")
    df = pd.read_csv(feature_path)
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    total_len = len(df)
    print(f"Total rows available: {total_len}. Train size = {train_size}, Test size = {test_size}, Step size = {step_size}")
    
    if total_len < (train_size + test_size):
        raise ValueError(f"Insufficient data ({total_len} rows) for train_size ({train_size}) and test_size ({test_size}).")
        
    start_idx = 0
    fold = 1
    results = []
    
    while start_idx + train_size + test_size <= total_len:
        print(f"\n--- Running Fold {fold} ---")
        train_df = df.iloc[start_idx : start_idx + train_size].copy()
        test_df = df.iloc[start_idx + train_size : start_idx + train_size + test_size].copy()
        
        print(f"Train period: {train_df['Date'].min().strftime('%Y-%m-%d')} to {train_df['Date'].max().strftime('%Y-%m-%d')}")
        print(f"Test period:  {test_df['Date'].min().strftime('%Y-%m-%d')} to {test_df['Date'].max().strftime('%Y-%m-%d')}")
        
        # 1. Fit ARIMA on train close
        train_close = train_df['Close'].values
        arima_model = ARIMA(train_close, order=arima_order)
        try:
            arima_result = arima_model.fit()
        except Exception as e:
            print(f"ARIMA fitting failed in fold {fold}: {e}. Skipping this fold.")
            start_idx += step_size
            fold += 1
            continue
            
        train_df['ARIMA_Pred'] = arima_result.fittedvalues
        train_df['Residual'] = train_df['Close'] - train_df['ARIMA_Pred']
        
        # 2. Scale residuals
        scaler = MinMaxScaler(feature_range=(-1, 1))
        train_residuals = train_df['Residual'].values.reshape(-1, 1)
        scaled_residuals = scaler.fit_transform(train_residuals).flatten()
        
        # 3. Create sequences for LSTM
        X_lstm, y_lstm = create_lstm_sequences(scaled_residuals, seq_length)
        
        # Convert to PyTorch tensors
        X_tensor = torch.tensor(X_lstm, dtype=torch.float32).unsqueeze(-1) # shape (samples, seq_length, 1)
        y_tensor = torch.tensor(y_lstm, dtype=torch.float32).unsqueeze(-1) # shape (samples, 1)
        
        # Build and train PyTorch LSTM
        model = ResidualLSTM(input_size=1, hidden_size=32, num_layers=1, output_size=1)
        criterion = nn.MSELoss()
        optimizer = optim.Adam(model.parameters(), lr=0.005)
        
        model.train()
        for epoch in range(epochs):
            optimizer.zero_grad()
            outputs = model(X_tensor)
            loss = criterion(outputs, y_tensor)
            loss.backward()
            optimizer.step()
            
        # 4. Predict on Test
        arima_test_preds = arima_result.forecast(steps=len(test_df))
        test_df['ARIMA_Pred'] = arima_test_preds
        test_df['Residual'] = test_df['Close'] - test_df['ARIMA_Pred']
        
        # Scale test residuals
        test_residuals = test_df['Residual'].values.reshape(-1, 1)
        scaled_test_residuals = scaler.transform(test_residuals).flatten()
        
        # Prepare LSTM inputs for test
        full_residuals = np.concatenate([scaled_residuals[-seq_length:], scaled_test_residuals])
        X_test_lstm, _ = create_lstm_sequences(full_residuals, seq_length)
        X_test_tensor = torch.tensor(X_test_lstm, dtype=torch.float32).unsqueeze(-1)
        
        # Predict LSTM (PyTorch inference)
        model.eval()
        with torch.no_grad():
            lstm_scaled_preds = model(X_test_tensor).numpy().flatten()
            
        lstm_preds = scaler.inverse_transform(lstm_scaled_preds.reshape(-1, 1)).flatten()
        
        test_df['LSTM_Pred'] = lstm_preds
        test_df['Hybrid_Pred'] = test_df['ARIMA_Pred'] + test_df['LSTM_Pred']
        
        # 5. Evaluate fold metrics
        test_df['Actual_Return'] = test_df['Close'].pct_change()
        test_df['Actual_Dir'] = (test_df['Actual_Return'] > 0).astype(int)
        
        test_df['Prev_Close'] = test_df['Close'].shift(1)
        test_df['Pred_Change'] = test_df['Hybrid_Pred'] - test_df['Prev_Close']
        test_df['Pred_Dir'] = (test_df['Pred_Change'] > 0).astype(int)
        
        eval_df = test_df.dropna().copy()
        
        correct_preds = (eval_df['Actual_Dir'] == eval_df['Pred_Dir']).sum()
        accuracy = correct_preds / len(eval_df) if len(eval_df) > 0 else 0.0
        
        eval_df['Position'] = np.where(eval_df['Pred_Change'] > 0, 1, -1)
        eval_df['Strategy_Return'] = eval_df['Position'] * eval_df['Actual_Return']
        
        sharpe = calculate_sharpe_ratio(eval_df['Strategy_Return'])
        max_dd = calculate_max_drawdown(eval_df['Strategy_Return'])
        
        print(f"Fold {fold} Metrics: Accuracy = {accuracy:.2%}, Sharpe Ratio = {sharpe:.4f}, Max Drawdown = {max_dd:.2%}")
        
        results.append({
            'fold': fold,
            'accuracy': accuracy,
            'sharpe': sharpe,
            'max_dd': max_dd,
            'start_date': train_df['Date'].min(),
            'end_date': test_df['Date'].max()
        })
        
        start_idx += step_size
        fold += 1
        
    if not results:
        print("No validation folds were successfully executed.")
        return
        
    avg_accuracy = np.mean([r['accuracy'] for r in results])
    avg_sharpe = np.mean([r['sharpe'] for r in results])
    avg_max_dd = np.mean([r['max_dd'] for r in results])
    
    print("\n" + "="*40)
    print("WALK-FORWARD VALIDATION SUMMARY")
    print("="*40)
    for r in results:
        print(f"Fold {r['fold']} ({r['start_date'].strftime('%Y-%m-%d')} to {r['end_date'].strftime('%Y-%m-%d')}):")
        print(f"  Accuracy:     {r['accuracy']:.2%}")
        print(f"  Sharpe Ratio: {r['sharpe']:.4f}")
        print(f"  Max Drawdown: {r['max_dd']:.2%}")
    print("-"*40)
    print(f"Average Accuracy:     {avg_accuracy:.2%}")
    print(f"Average Sharpe Ratio: {avg_sharpe:.4f}")
    print(f"Average Max Drawdown: {avg_max_dd:.2%}")
    print("="*40)
    
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Walk-Forward Validation.")
    parser.add_argument("--features", type=str, required=True, help="Path to feature-engineered CSV file")
    parser.add_argument("--train_size", type=int, default=750, help="Number of trading days for training")
    parser.add_argument("--test_size", type=int, default=250, help="Number of trading days for testing")
    parser.add_argument("--step_size", type=int, default=250, help="Slide step size in trading days")
    parser.add_argument("--epochs", type=int, default=5, help="Number of LSTM epochs per fold")
    
    args = parser.parse_args()
    
    try:
        run_wfv(
            args.features,
            train_size=args.train_size,
            test_size=args.test_size,
            step_size=args.step_size,
            epochs=args.epochs
        )
    except Exception as e:
        print(f"Error running walk-forward validation: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
