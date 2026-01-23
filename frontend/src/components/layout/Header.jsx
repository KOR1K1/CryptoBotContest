import { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import Button from '../ui/Button';
import Tooltip from '../ui/Tooltip';

const Header = () => {
  const { user, logout } = useAuth();
  const [balance, setBalance] = useState({ balance: 0, lockedBalance: 0, total: 0 });
  const balanceIntervalRef = useRef(null);

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

    const handleWindowBlur = () => {
      stopPolling();
    };

    const handleWindowFocus = () => {
      if (!document.hidden && document.visibilityState !== 'hidden') {
        refreshBalance(); // Immediate refresh
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
    <header className="bg-bg-card/80 backdrop-blur-lg border border-border rounded-xl px-6 py-4 mb-6 shadow-lg">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        {/* Logo/Title */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">
            Система аукционов
          </h1>
        </div>

        {/* User Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto min-w-0">
          {user ? (
            <>
              {/* User Info */}
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
                <div className="flex items-center gap-2 px-2 sm:px-3 py-1.5 bg-bg-secondary rounded-lg border border-border min-w-0 overflow-hidden">
                  <div className="w-8 h-8 rounded-full bg-accent-primary flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                    {user.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <span className="text-text-primary font-medium truncate min-w-0">
                    {user.username || user.id}
                  </span>
                </div>
                
                <Tooltip content="Выйти из аккаунта">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    className="flex-shrink-0"
                    leftIcon={
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    }
                  >
                    <span className="hidden sm:inline">Выход</span>
                  </Button>
                </Tooltip>
              </div>

              {/* Balance Display */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2 bg-bg-secondary rounded-lg border border-border w-full sm:w-auto overflow-x-auto sm:overflow-x-visible">
                <Tooltip content="Доступный баланс для размещения ставок">
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <span className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">Доступно</span>
                    <span className="text-base sm:text-lg font-semibold text-text-primary whitespace-nowrap">
                      {balance.balance.toFixed(2)}
                    </span>
                  </div>
                </Tooltip>

                <div className="w-px h-8 bg-border flex-shrink-0" />

                <Tooltip content="Баланс заблокирован в активных ставках">
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <span className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">Заблокировано</span>
                    <span className={`text-base sm:text-lg font-semibold whitespace-nowrap ${balance.lockedBalance > 0 ? 'text-status-warning' : 'text-text-secondary'}`}>
                      {balance.lockedBalance.toFixed(2)}
                    </span>
                  </div>
                </Tooltip>

                <div className="w-px h-8 bg-border flex-shrink-0" />

                <Tooltip content="Общий баланс (доступно + заблокировано)">
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <span className="text-xs text-text-muted uppercase tracking-wide whitespace-nowrap">Всего</span>
                    <span className="text-base sm:text-lg font-semibold text-status-success whitespace-nowrap">
                      {balance.total.toFixed(2)}
                    </span>
                  </div>
                </Tooltip>
              </div>
            </>
          ) : (
            <div className="text-text-muted text-sm">
              Не авторизован
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
