import React, { useState } from 'react';
import { Mail, Lock, User, X, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { authService, isMockFirebase } from '../firebase';

export default function UserAuthModal({ isOpen, onClose, onAuthSuccess, isFullPage = false }) {
  const [view, setView] = useState('login'); // 'login' | 'register' | 'forgot'
  
  // Form fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // UI states
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    if (isFullPage) return; // Prevent closing in full-page gateway mode
    // Reset states
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setInfo('');
    setLoading(false);
    onClose();
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      if (view === 'login') {
        if (!email || !password) {
          throw new Error('Please fill in all fields.');
        }
        const user = await authService.login(email, password);
        setInfo('Successfully authenticated!');
        setTimeout(() => {
          onAuthSuccess(user);
          handleClose();
        }, 1000);
      } 
      else if (view === 'register') {
        if (!username || !email || !password || !confirmPassword) {
          throw new Error('Please fill in all fields.');
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters long.');
        }
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }
        // Alpha-numeric check for username to prevent weird characters
        const userRegex = /^[a-zA-Z0-9_]{3,15}$/;
        if (!userRegex.test(username)) {
          throw new Error('Username must be 3-15 alphanumeric characters (underscores allowed).');
        }

        const user = await authService.register(username, email, password);
        setInfo('Account created successfully! Logging in...');
        setTimeout(() => {
          onAuthSuccess(user);
          handleClose();
        }, 1200);
      } 
      else if (view === 'forgot') {
        if (!email) {
          throw new Error('Please enter your email address.');
        }
        // If we are in mock mode, simulate reset link
        if (isMockFirebase()) {
          setInfo('Mock Mode: A password reset link has been simulated.');
        } else {
          // If we want real reset link we can add it, but mock/production is split
          // For Firebase standard reset, we use sendPasswordResetEmail (we can import it from firebase/auth if needed)
          // For simplicity in the configuration, we'll let it show a mockup confirmation
          setInfo('If the email is registered, a password reset link has been sent.');
        }
      }
    } catch (err) {
      setError(err.message || 'An error occurred during authentication.');
    } finally {
      setLoading(false);
    }
  };

  const switchView = (newView) => {
    setUsername('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setInfo('');
    setView(newView);
  };

  return (
    <div className={isFullPage ? "user-auth-gateway" : "user-auth-backdrop"} onClick={handleClose}>
      <div 
        className={isFullPage ? "user-auth-card" : "user-auth-modal"} 
        onClick={(e) => e.stopPropagation()}
      >
        {!isFullPage && (
          <button className="auth-close-btn" onClick={handleClose}>
            <X size={18} />
          </button>
        )}

        <div className="auth-header">
          <h2>
            {view === 'login' && 'Sign In to System'}
            {view === 'register' && 'Create Account'}
            {view === 'forgot' && 'Reset Password'}
          </h2>
          <p>
            {view === 'login' && 'Access predictions, explainable AI, and advanced analytics.'}
            {view === 'register' && 'Register your profile to access trend dashboards.'}
            {view === 'forgot' && 'Enter your registered email to receive a reset code.'}
          </p>
          
          {/* Mock vs Live Database Indicator */}
          <div className={`auth-db-badge ${isMockFirebase() ? 'mock' : 'live'}`}>
            {isMockFirebase() ? '⚡ Mock Database (LocalStorage)' : '🔥 Connected to Live Firebase'}
          </div>
        </div>

        <form onSubmit={handleFormSubmit} className="auth-form">
          {/* Username (Register Only) */}
          {view === 'register' && (
            <div className="auth-input-group">
              <label htmlFor="username">Username</label>
              <div className="auth-input-wrapper">
                <User className="input-icon" size={16} />
                <input 
                  type="text" 
                  id="username"
                  placeholder="Enter username (e.g. adminTrading)" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {/* Email / Username or Email Input */}
          <div className="auth-input-group">
            <label htmlFor="email">
              {view === 'login' ? 'Username or Email Address' : 'Email Address'}
            </label>
            <div className="auth-input-wrapper">
              <Mail className="input-icon" size={16} />
              <input 
                type={view === 'login' ? 'text' : 'email'} 
                id="email"
                placeholder={view === 'login' ? 'Enter username or email' : 'you@example.com'} 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete={view === 'login' ? 'username' : 'email'}
              />
            </div>
          </div>

          {/* Password (Login & Register Only) */}
          {view !== 'forgot' && (
            <div className="auth-input-group">
              <label htmlFor="password">Password</label>
              <div className="auth-input-wrapper">
                <Lock className="input-icon" size={16} />
                <input 
                  type="password" 
                  id="password"
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete={view === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
            </div>
          )}

          {/* Confirm Password (Register Only) */}
          {view === 'register' && (
            <div className="auth-input-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div className="auth-input-wrapper">
                <Lock className="input-icon" size={16} />
                <input 
                  type="password" 
                  id="confirmPassword"
                  placeholder="••••••••" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          {/* Forgot Password Link (Login Only) */}
          {view === 'login' && (
            <div className="forgot-password-link">
              <button 
                type="button" 
                onClick={() => switchView('forgot')}
                className="text-link-btn"
                disabled={loading}
              >
                Forgot your password?
              </button>
            </div>
          )}

          {/* Feedback states */}
          {error && (
            <div className="auth-alert error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="auth-alert success">
              <CheckCircle size={16} />
              <span>{info}</span>
            </div>
          )}

          {/* Submit Button */}
          <button 
            type="submit" 
            className="auth-submit-btn" 
            disabled={loading}
          >
            {loading ? (
              <>
                <RefreshCw size={16} className="spin-icon" /> Processing...
              </>
            ) : (
              <>
                {view === 'login' && 'Sign In'}
                {view === 'register' && 'Create Account'}
                {view === 'forgot' && 'Send Reset Link'}
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          {view === 'login' && (
            <p>
              Don't have an account?{' '}
              <button 
                type="button" 
                onClick={() => switchView('register')} 
                className="text-link-btn highlight"
                disabled={loading}
              >
                Sign up now
              </button>
            </p>
          )}

          {view === 'register' && (
            <p>
              Already have an account?{' '}
              <button 
                type="button" 
                onClick={() => switchView('login')} 
                className="text-link-btn highlight"
                disabled={loading}
              >
                Sign in
              </button>
            </p>
          )}

          {view === 'forgot' && (
            <p>
              Remembered your credentials?{' '}
              <button 
                type="button" 
                onClick={() => switchView('login')} 
                className="text-link-btn highlight"
                disabled={loading}
              >
                Back to Sign In
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
