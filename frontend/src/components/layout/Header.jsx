import { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../ui/Button';
import Tooltip from '../ui/Tooltip';

/**
 * Header Component
 * 
 * Шапка приложения с информацией о пользователе и балансе
 */
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

    // Also handle window blur/focus events (for browser minimization)
    const handleWindowBlur = () => {
      // Browser window lost focus (minimized or switched to another app)
      stopPolling();
    };

    const handleWindowFocus = () => {
      // Browser window regained focus
      if (!document.hidden && document.visibilityState !== 'hidden') {
        refreshBalance(); // Immediate refresh
        startPolling(ACTIVE_INTERVAL);
      }
    };

    // Start with active interval (only if tab is visible)
    if (!document.hidden && document.visibilityState !== 'hidden') {
      startPolling(ACTIVE_INTERVAL);
    }

    // Listen for tab visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Listen for window blur/focus (for browser minimization)
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
    <header className="bg-bg-card/80 backdrop-blur-lg border border-border rounded-xl px-6 py-4 mb-6 shadow-lg">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Logo/Title */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">
            Auction System
          </h1>
        </div>

        {/* User Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {user ? (
            <>
              {/* User Info */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary rounded-lg border border-border">
                  <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white font-semibold text-sm">
                    {user.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <span className="text-text-primary font-medium">
                    {user.username || user.id}
                  </span>
                </div>
                
                <Tooltip content="Logout from your account">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    leftIcon={
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    }
                  >
                    Logout
                  </Button>
                </Tooltip>
              </div>

              {/* Balance Display */}
              <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-bg-secondary rounded-lg border border-border">
                <Tooltip content="Available balance for placing bids">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted uppercase tracking-wide">Available</span>
                    <span className="text-lg font-semibold text-text-primary">
                      {balance.balance.toFixed(2)}
                    </span>
                  </div>
                </Tooltip>

                <div className="w-px h-8 bg-border" />

                <Tooltip content="Balance locked in active bids">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted uppercase tracking-wide">Locked</span>
                    <span className={`text-lg font-semibold ${balance.lockedBalance > 0 ? 'text-status-warning' : 'text-text-secondary'}`}>
                      {balance.lockedBalance.toFixed(2)}
                    </span>
                  </div>
                </Tooltip>

                <div className="w-px h-8 bg-border" />

                <Tooltip content="Total balance (available + locked)">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted uppercase tracking-wide">Total</span>
                    <span className="text-lg font-semibold text-status-success">
                      {balance.total.toFixed(2)}
                    </span>
                  </div>
                </Tooltip>
              </div>
            </>
          ) : (
            <div className="text-text-muted text-sm">
              Not logged in
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
