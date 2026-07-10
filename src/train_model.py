import os
import argparse
import pickle
import pandas as pd
import numpy as np
import lightgbm as lgb

def train_pipeline(feature_path: str, ticker: str, interval: str = "1d", epochs=15):
    """
    Runs the training pipeline:
    1. Loads features and splits data chronologically (80% train, 20% test).
    2. Trains an optimized LightGBM Regressor (with early stopping) to predict Close price.
    3. Trains an optimized LightGBM Classifier (with early stopping) to predict trend direction.
    4. Saves both models and metadata.
    """
    print(f"Loading features from '{feature_path}'...")
    df = pd.read_csv(feature_path)
    
    # Ensure sorted by date
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    # Define splits chronologically
    split_idx = int(len(df) * 0.8)
    
    print(f"Data Split: Train size = {split_idx}, Test size = {len(df) - split_idx}")
    
    # Target values: predict tomorrow's close price and trend direction
    df['Target_Close'] = df['Close'].shift(-1)
    df['Target_Direction'] = (df['Close'].shift(-1) > df['Close']).astype(int)
    
    # Drop last row since it doesn't have a shift target
    df_clean = df.dropna(subset=['Target_Close']).reset_index(drop=True)
    
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
            
    # Chronological splits
    train_df = df_clean.iloc[:split_idx]
    test_df = df_clean.iloc[split_idx:]
    
    X_train = train_df[feature_cols]
    y_train_close = train_df['Target_Close']
    y_train_dir = train_df['Target_Direction']
    
    X_test = test_df[feature_cols]
    y_test_close = test_df['Target_Close']
    y_test_dir = test_df['Target_Direction']
    
    # Optimized Hyperparameters to prevent overfitting and improve generalization
    reg_params = {
        'objective': 'regression',
        'metric': 'rmse',
        'boosting_type': 'gbdt',
        'learning_rate': 0.03,        # Low learning rate for stability
        'num_leaves': 15,             # Smaller trees to reduce overfitting
        'max_depth': 5,               # Explicit depth limit
        'feature_fraction': 0.8,      # Colsample by tree
        'bagging_fraction': 0.8,      # Row subsample
        'bagging_freq': 5,
        'min_data_in_leaf': 15,       # Minimum records in leaf
        'lambda_l1': 0.1,             # L1 regularization
        'lambda_l2': 0.1,             # L2 regularization
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
    
    # --- 1. Train LightGBM Regressor (Close Price) ---
    print("Training optimized LightGBM Regressor for close prices...")
    lgb_reg_train = lgb.Dataset(X_train, label=y_train_close)
    lgb_reg_val = lgb.Dataset(X_test, label=y_test_close, reference=lgb_reg_train)
    
    lgb_reg = lgb.train(
        reg_params, 
        lgb_reg_train, 
        num_boost_round=150,
        valid_sets=[lgb_reg_train, lgb_reg_val],
        callbacks=[lgb.early_stopping(20, verbose=False)]
    )
    
    # --- 2. Train LightGBM Classifier (Trend Direction) ---
    print("Training optimized LightGBM Classifier for trend direction...")
    lgb_clf_train = lgb.Dataset(X_train, label=y_train_dir)
    lgb_clf_val = lgb.Dataset(X_test, label=y_test_dir, reference=lgb_clf_train)
    
    lgb_clf = lgb.train(
        clf_params, 
        lgb_clf_train, 
        num_boost_round=150,
        valid_sets=[lgb_clf_train, lgb_clf_val],
        callbacks=[lgb.early_stopping(20, verbose=False)]
    )
    
    # --- 3. Evaluate on Test set ---
    print("Evaluating optimized LightGBM models on test set...")
    pred_closes = lgb_reg.predict(X_test)
    pred_dir_probs = lgb_clf.predict(X_test)
    pred_dirs = (pred_dir_probs > 0.5).astype(int)
    
    # Calculate directional accuracy
    correct_dir = (pred_dirs == y_test_dir).sum()
    accuracy = correct_dir / len(y_test_dir) if len(y_test_dir) > 0 else 0.0
    print(f"Test LightGBM Directional Accuracy: {accuracy:.2%}")
    
    # --- 4. Save models ---
    os.makedirs("models", exist_ok=True)
    
    t_lower = ticker.lower()
    i_lower = interval.lower()
    lgb_reg_path = f"models/lgb_reg_{t_lower}_{i_lower}.txt"
    lgb_clf_path = f"models/lgb_clf_{t_lower}_{i_lower}.txt"
    
    lgb_reg.save_model(lgb_reg_path)
    lgb_clf.save_model(lgb_clf_path)
    
    # Save meta-info
    from datetime import datetime
    meta_info = {
        'ticker': ticker,
        'interval': interval,
        'feature_cols': feature_cols,
        'accuracy': float(accuracy),
        'train_size': int(len(train_df)),
        'test_size': int(len(test_df)),
        'epochs': epochs,
        'trained_at': datetime.now().isoformat()
    }
    with open(f"models/meta_{t_lower}_{i_lower}.pkl", 'wb') as f:
        pickle.dump(meta_info, f)
        
    print("All LightGBM models and metadata successfully saved to 'models/' directory.")
    return meta_info

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train LightGBM Regression and Classification models.")
    parser.add_argument("--features", type=str, required=True, help="Path to feature-engineered CSV file")
    parser.add_argument("--ticker", type=str, required=True, help="Stock ticker symbol")
    parser.add_argument("--interval", type=str, default="1d", help="Data interval/timeframe")
    parser.add_argument("--epochs", type=int, default=15, help="Number of epochs (kept for argument compatibility)")
    
    args = parser.parse_args()
    
    try:
        train_pipeline(args.features, args.ticker, interval=args.interval, epochs=args.epochs)
    except Exception as e:
        print(f"Error during training: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
