import os
import argparse
import pandas as pd
import numpy as np
import lightgbm as lgb

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

def run_wfv(feature_path: str, train_size=750, test_size=250, step_size=250, epochs=5):
    """
    Executes walk-forward validation on feature-engineered stock data using LightGBM.
    """
    print(f"Loading features for Walk-Forward Validation from '{feature_path}'...")
    df = pd.read_csv(feature_path)
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    # Target values: predict tomorrow's close price and trend direction
    df['Target_Close'] = df['Close'].shift(-1)
    df['Target_Direction'] = (df['Close'].shift(-1) > df['Close']).astype(int)
    
    # Drop last row since it doesn't have a shift target
    df_clean = df.dropna(subset=['Target_Close']).reset_index(drop=True)
    
    total_len = len(df_clean)
    print(f"Total rows available: {total_len}. Original parameters: Train size = {train_size}, Test size = {test_size}, Step size = {step_size}")
    
    if total_len < (train_size + test_size):
        # Dynamically adjust train/test/step size if the dataset is small!
        train_size = int(total_len * 0.6)
        test_size = int(total_len * 0.2)
        step_size = test_size
        print(f"Adjusted WFV parameters due to small dataset: Train size = {train_size}, Test size = {test_size}, Step size = {step_size}")
        if train_size < 10 or test_size < 3:
            raise ValueError(f"Insufficient data ({total_len} rows) even after dynamic scaling for walk-forward validation.")
            
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
        'Elliott_Wave',
        # Fibonacci features
        'Dist_Fib_236_20', 'Dist_Fib_382_20', 'Dist_Fib_500_20', 'Dist_Fib_618_20', 'Dist_Fib_786_20',
        'Dist_Fib_236_50', 'Dist_Fib_382_50', 'Dist_Fib_500_50', 'Dist_Fib_618_50', 'Dist_Fib_786_50'
    ]
    
    # Dynamically append PDF strategy patterns if present
    pdf_features = [
        'CDL_Hammer', 'CDL_Inverted_Hammer', 'CDL_Shooting_Star', 'CDL_Doji',
        'CDL_Bullish_Engulfing', 'CDL_Bearish_Engulfing', 'CDL_Marubozu',
        'Pattern_Double_Top', 'Pattern_Double_Bottom',
        'SMC_Breaker_Bullish', 'SMC_Breaker_Bearish', 'SMC_Premium_Discount'
    ]
    for pf in pdf_features:
        if pf in df_clean.columns:
            feature_cols.append(pf)
            
    start_idx = 0
    fold = 1
    results = []
    
    # Hyperparameters matching the optimized train_model setup
    reg_params = {
        'objective': 'regression',
        'metric': 'rmse',
        'boosting_type': 'gbdt',
        'learning_rate': 0.03,
        'num_leaves': 15,
        'max_depth': 5,
        'feature_fraction': 0.8,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'min_data_in_leaf': 15,
        'lambda_l1': 0.1,
        'lambda_l2': 0.1,
        'verbose': -1,
        'random_state': 42
    }
    
    clf_params = {
        'objective': 'binary',
        'metric': 'binary_logloss',
        'boosting_type': 'gbdt',
        'learning_rate': 0.03,
        'num_leaves': 15,
        'max_depth': 5,
        'feature_fraction': 0.8,
        'bagging_fraction': 0.8,
        'bagging_freq': 5,
        'min_data_in_leaf': 15,
        'lambda_l1': 0.1,
        'lambda_l2': 0.1,
        'verbose': -1,
        'random_state': 42
    }
    
    while start_idx + train_size + test_size <= total_len:
        print(f"\n--- Running Fold {fold} ---")
        train_df = df_clean.iloc[start_idx : start_idx + train_size].copy()
        test_df = df_clean.iloc[start_idx + train_size : start_idx + start_idx + train_size + test_size].copy()
        
        print(f"Train period: {train_df['Date'].min().strftime('%Y-%m-%d')} to {train_df['Date'].max().strftime('%Y-%m-%d')}")
        print(f"Test period:  {test_df['Date'].min().strftime('%Y-%m-%d')} to {test_df['Date'].max().strftime('%Y-%m-%d')}")
        
        X_train = train_df[feature_cols]
        y_train_close = train_df['Target_Close']
        y_train_dir = train_df['Target_Direction']
        
        X_test = test_df[feature_cols]
        y_test_close = test_df['Target_Close']
        y_test_dir = test_df['Target_Direction']
        
        # 1. Train LightGBM Regressor
        lgb_reg_train = lgb.Dataset(X_train, label=y_train_close)
        lgb_reg_val = lgb.Dataset(X_test, label=y_test_close, reference=lgb_reg_train)
        lgb_reg = lgb.train(
            reg_params, 
            lgb_reg_train, 
            num_boost_round=150,
            valid_sets=[lgb_reg_train, lgb_reg_val],
            callbacks=[lgb.early_stopping(20, verbose=False)]
        )
        
        # 2. Train LightGBM Classifier
        lgb_clf_train = lgb.Dataset(X_train, label=y_train_dir)
        lgb_clf_val = lgb.Dataset(X_test, label=y_test_dir, reference=lgb_clf_train)
        lgb_clf = lgb.train(
            clf_params, 
            lgb_clf_train, 
            num_boost_round=150,
            valid_sets=[lgb_clf_train, lgb_clf_val],
            callbacks=[lgb.early_stopping(20, verbose=False)]
        )
        
        # 3. Predict on Test
        pred_closes = lgb_reg.predict(X_test)
        pred_dir_probs = lgb_clf.predict(X_test)
        pred_dirs = (pred_dir_probs > 0.5).astype(int)
        
        test_df['Reg_Pred_Close'] = pred_closes
        test_df['Pred_Dir'] = pred_dirs
        
        # 4. Evaluate fold metrics
        test_df['Actual_Return'] = test_df['Close'].pct_change()
        test_df['Actual_Dir'] = (test_df['Actual_Return'] > 0).astype(int)
        
        eval_df = test_df.dropna().copy()
        
        correct_preds = (eval_df['Actual_Dir'] == eval_df['Pred_Dir']).sum()
        accuracy = correct_preds / len(eval_df) if len(eval_df) > 0 else 0.0
        
        eval_df['Position'] = np.where(eval_df['Pred_Dir'] == 1, 1, -1)
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
        return []
        
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
    parser.add_argument("--epochs", type=int, default=5, help="Epochs argument (kept for CLI compatibility)")
    
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
