import { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const Header = () => {
  const { user, logout } = useAuth();
  const [balance, setBalance] = useState({ balance: 0, lockedBalance: 0, total: 0 });
  const balanceIntervalRef = useRef(null);

  // Load balance when user changes
  useEffect(() => {
    if (!user?.id) {
      setBalance({ balance: 0, lockedBalance: 0, total: 0 });
      return;
    }

    const loadBalance = async () => {
      try {
        const balanceData = await apiRequest(`/users/${user.id}/balance`);
        setBalance(balanceData);
      } catch (error) {
        console.error('Error loading user balance:', error);
      }
    };

    loadBalance();
  }, [user?.id]);

  // Refresh balance periodically (only when tab is visible)
  useEffect(() => {
    if (!user?.id) {
      return;
    }

    // Clear any existing interval
    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current);
      balanceIntervalRef.current = null;
    }

    const ACTIVE_INTERVAL = 5000; // 5 seconds when tab is active
    const INACTIVE_INTERVAL = 30000; // 30 seconds when tab is hidden (or disable)

    const refreshBalance = async () => {
      // Double-check: Skip refresh if tab is hidden (defensive check)
      if (document.hidden || document.visibilityState === 'hidden') {
        return;
      }

      try {
        const updated = await apiRequest(`/users/${user.id}/balance`);
        setBalance(updated);
      } catch (error) {
        console.error('Error refreshing balance:', error);
      }
    };

    const startPolling = (interval) => {
      // Clear existing interval first
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
      // Only start polling if tab is visible
      if (!document.hidden && document.visibilityState !== 'hidden') {
        balanceIntervalRef.current = setInterval(refreshBalance, interval);
      }
    };

    const stopPolling = () => {
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        // Tab is hidden or browser minimized - STOP polling completely
        stopPolling();
      } else {
        // Tab is visible - resume normal polling
        refreshBalance(); // Immediate refresh when tab becomes visible
        startPolling(ACTIVE_INTERVAL);
      }
    };

    const handleWindowBlur = () => {
      stopPolling();
    };

    const handleWindowFocus = () => {
      if (!document.hidden && document.visibilityState !== 'hidden') {
        refreshBalance();
        startPolling(ACTIVE_INTERVAL);
      }
    };

    if (!document.hidden && document.visibilityState !== 'hidden') {
      startPolling(ACTIVE_INTERVAL);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [user?.id]);

  return (
    <header>
      <h1>Auction System</h1>
      <div className="user-section">
        {user ? (
          <>
            <div className="user-info">
              <span className="username">{user.username || user.id}</span>
              <button className="btn-secondary" onClick={logout} style={{ marginLeft: '1rem' }}>
                Logout
              </button>
            </div>
            <div className="balance-display">
              <div className="balance-item">
                <span className="label">Available</span>
                <span className="value">{balance.balance.toFixed(2)}</span>
              </div>
              <div className="balance-item">
                <span className="label">Locked</span>
                <span className="value" style={{ color: balance.lockedBalance > 0 ? 'var(--warning)' : 'var(--accent-secondary)' }}>
                  {balance.lockedBalance.toFixed(2)}
                </span>
              </div>
              <div className="balance-item">
                <span className="label">Total</span>
                <span className="value" style={{ color: 'var(--success)' }}>
                  {balance.total.toFixed(2)}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="user-info">
            <span>Not logged in</span>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
